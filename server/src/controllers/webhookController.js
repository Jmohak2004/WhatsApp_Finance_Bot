import fs from "fs/promises";
import { Document } from "../models/Document.js";
import { Transaction } from "../models/Transaction.js";
import {
  analyzeDocumentWithNvidia,
  extractTransactionFromText,
  parseTransactionFallback,
  transcribeAudioWithNvidia
} from "../services/nvidiaService.js";
import { getAnalysis } from "../services/analysisService.js";
import { buildGstPdfBuffer } from "../services/pdfService.js";
import { extractTextFromDocumentLocally } from "../services/localExtractionService.js";
import {
  createKhataEntry,
  formatKhataSavedMessage,
  formatKhataSummaryMessage,
  getKhataSummary,
  parseKhataMessage
} from "../services/khataService.js";
import {
  applyInventoryUpdate,
  formatInventoryItemMessage,
  formatInventorySavedMessage,
  formatInventorySummaryMessage,
  formatInventoryThresholdMessage,
  getInventoryItem,
  getInventorySummary,
  parseInventoryMessage,
  setInventoryThreshold,
  sendLowStockNotification
} from "../services/inventoryService.js";
import { downloadTwilioMedia } from "../utils/media.js";
import { twilioXmlReply } from "../utils/twilioReply.js";
import { env } from "../config/env.js";

const parsePeriod = (text = "") => {
  if (text.includes("week")) return "week";
  if (text.includes("year")) return "year";
  return "month";
};

const buildHelpText = () =>
  `Commands:\n1) Add transaction by text: "spent 1200 on fuel today"\n2) Send voice note with transaction details\n3) Upload receipt/bill image or PDF\n4) analysis week|month|year\n5) gst week|month|year\n6) Khata entry: "I sent 500 to Rahul"\n7) Khata settlement: "Rahul paid back 300"\n8) khata (summary)\n9) Inventory add: "add 250 soaps"\n10) Inventory remove: "sent 80 soaps"\n11) Set threshold: "threshold soaps 120"\n12) inventory summary / low stock`;

const saveTransaction = async ({ userPhone, source, parsed, rawInput = "", documentId = null }) => {
  return Transaction.create({
    userPhone,
    source,
    type: parsed.type,
    amount: Number(parsed.amount || 0),
    category: parsed.category || "Other",
    description: parsed.description || "",
    merchant: parsed.merchant || "",
    transactionDate: parsed.transactionDate ? new Date(parsed.transactionDate) : new Date(),
    gstRate: Number(parsed.gstRate || 0),
    gstAmount: Number(parsed.gstAmount || 0),
    rawInput,
    documentId
  });
};

const parseBestEffortTransaction = async (text) => {
  try {
    return await extractTransactionFromText(text);
  } catch {
    const parsed = parseTransactionFallback(text);
    return Number(parsed.amount) > 0 ? parsed : null;
  }
};

export const twilioWebhook = async (req, res) => {
  try {
    const bodyText = req.body.Body || "";
    const userPhone = req.body.From || "unknown";
    const numMedia = Number(req.body.NumMedia || 0);
    const normalized = bodyText.toLowerCase().trim();

    if (!bodyText && numMedia === 0) {
      return res.type("text/xml").send(twilioXmlReply("Message is empty. Type 'help' for commands."));
    }

    if (numMedia > 0) {
      const mediaUrl = req.body.MediaUrl0;
      const incomingAccountSid = req.body.AccountSid || "";

      if (!mediaUrl) {
        return res
          .type("text/xml")
          .send(twilioXmlReply("Media received but MediaUrl is missing. Please resend the image."));
      }

      let downloaded;
      try {
        downloaded = await downloadTwilioMedia(mediaUrl, "uploads", {
          accountSid: incomingAccountSid
        });
      } catch (error) {
        console.error("Twilio media download failed", error?.message || error);

        if (error?.status === 401 || error?.code === "TWILIO_MEDIA_AUTH_FAILED") {
          return res
            .type("text/xml")
            .send(
              twilioXmlReply(
                "Image received, but Twilio media download failed due to auth mismatch. Update TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN for the same Twilio account handling this WhatsApp webhook."
              )
            );
        }

        return res
          .type("text/xml")
          .send(twilioXmlReply("Could not download media right now. Please resend the image."));
      }

      const isAudio = downloaded.mimeType.startsWith("audio/");
      const kind = isAudio
        ? "voice"
        : downloaded.mimeType.includes("pdf")
          ? "bill"
          : downloaded.mimeType.startsWith("image/")
            ? "receipt"
            : "other";

      if (isAudio) {
        try {
          const transcript = await transcribeAudioWithNvidia(
            downloaded.buffer,
            downloaded.mimeType,
            downloaded.fileName
          );

          const khataFromVoice = parseKhataMessage(transcript) || parseKhataMessage(bodyText);
          if (khataFromVoice) {
            const document = await Document.create({
              userPhone,
              kind,
              fileName: downloaded.fileName,
              mimeType: downloaded.mimeType,
              filePath: downloaded.filePath,
              extractedText: transcript,
              aiSummary: "Voice note transcribed via nvidia and stored in khata",
              parsedData: { khata: khataFromVoice }
            });

            await createKhataEntry({
              userPhone,
              parsed: khataFromVoice,
              source: "voice",
              rawInput: `${transcript}\n${bodyText}`.trim(),
              entryDate: new Date(),
              documentId: document._id
            });

            return res.type("text/xml").send(twilioXmlReply(formatKhataSavedMessage(khataFromVoice)));
          }

          const inventoryFromVoice = parseInventoryMessage(transcript) || parseInventoryMessage(bodyText);
          if (inventoryFromVoice) {
            if (inventoryFromVoice.action === "summary") {
              const summary = await getInventorySummary({ userPhone });
              return res.type("text/xml").send(twilioXmlReply(formatInventorySummaryMessage(summary)));
            }

            if (inventoryFromVoice.action === "low-stock") {
              const summary = await getInventorySummary({ userPhone });
              if (!summary.lowStockItems.length) {
                return res.type("text/xml").send(twilioXmlReply("No low stock items right now."));
              }

              const lowMessage = formatInventorySummaryMessage({
                ...summary,
                items: summary.lowStockItems
              });
              return res.type("text/xml").send(twilioXmlReply(lowMessage));
            }

            if (inventoryFromVoice.action === "item-summary") {
              const item = await getInventoryItem({ userPhone, itemKey: inventoryFromVoice.itemKey });
              return res.type("text/xml").send(twilioXmlReply(formatInventoryItemMessage(item)));
            }

            if (inventoryFromVoice.action === "update") {
              const result = await applyInventoryUpdate({
                userPhone,
                parsed: inventoryFromVoice,
                source: "voice",
                rawInput: `${transcript}\n${bodyText}`.trim()
              });

              if (result.crossedLowThreshold) {
                await sendLowStockNotification({ userPhone, item: result.item });
              }

              return res.type("text/xml").send(twilioXmlReply(formatInventorySavedMessage(result)));
            }

            if (inventoryFromVoice.action === "set-threshold") {
              const result = await setInventoryThreshold({
                userPhone,
                parsed: inventoryFromVoice,
                source: "voice",
                rawInput: `${transcript}\n${bodyText}`.trim()
              });

              return res.type("text/xml").send(twilioXmlReply(formatInventoryThresholdMessage(result)));
            }
          }

          const parsed = transcript ? await parseBestEffortTransaction(transcript) : null;

          if (!transcript) {
            throw new Error("NVIDIA transcription returned empty text");
          }

          const document = await Document.create({
            userPhone,
            kind,
            fileName: downloaded.fileName,
            mimeType: downloaded.mimeType,
            filePath: downloaded.filePath,
            extractedText: transcript,
            aiSummary: "Voice note transcribed via nvidia",
            parsedData: parsed || {}
          });

          if (!parsed) {
            const parsedFromCaption = parseTransactionFallback(bodyText);
            const canSaveFromCaption = Number(parsedFromCaption.amount) > 0;

            if (canSaveFromCaption) {
              await saveTransaction({
                userPhone,
                source: "voice",
                parsed: parsedFromCaption,
                rawInput: `${transcript}\n${bodyText}`.trim(),
                documentId: document._id
              });

              return res
                .type("text/xml")
                .send(
                  twilioXmlReply(
                    `Voice transcribed via nvidia. Saved from caption: INR ${parsedFromCaption.amount} as ${parsedFromCaption.category}.`
                  )
                );
            }

            return res
              .type("text/xml")
              .send(
                twilioXmlReply(
                  "Voice transcribed via nvidia, but no amount was detected. Try saying or captioning like 'spent 650 on food'."
                )
              );
          }

          await saveTransaction({
            userPhone,
            source: "voice",
            parsed,
            rawInput: transcript,
            documentId: document._id
          });

          return res
            .type("text/xml")
            .send(twilioXmlReply(`Voice transaction saved via nvidia: INR ${parsed.amount} as ${parsed.category}.`));
        } catch (error) {
          const parsedKhataFromCaption = parseKhataMessage(bodyText);
          const parsedInventoryFromCaption = parseInventoryMessage(bodyText);
          const parsedFromCaption = parseTransactionFallback(bodyText);
          const canSaveFromCaption = Number(parsedFromCaption.amount) > 0;

          const document = await Document.create({
            userPhone,
            kind,
            fileName: downloaded.fileName,
            mimeType: downloaded.mimeType,
            filePath: downloaded.filePath,
            extractedText: "",
            aiSummary: `Voice saved but transcription failed: ${error.message}`,
            parsedData: {}
          });

          if (canSaveFromCaption) {
            await saveTransaction({
              userPhone,
              source: "voice",
              parsed: parsedFromCaption,
              rawInput: bodyText,
              documentId: document._id
            });

            return res
              .type("text/xml")
              .send(
                twilioXmlReply(
                  `Voice uploaded. AI transcription unavailable, but saved from caption: INR ${parsedFromCaption.amount} as ${parsedFromCaption.category}.`
                )
              );
          }

          if (parsedKhataFromCaption) {
            await createKhataEntry({
              userPhone,
              parsed: parsedKhataFromCaption,
              source: "voice",
              rawInput: bodyText,
              entryDate: new Date(),
              documentId: document._id
            });

            return res.type("text/xml").send(twilioXmlReply(formatKhataSavedMessage(parsedKhataFromCaption)));
          }

          if (parsedInventoryFromCaption) {
            if (parsedInventoryFromCaption.action === "update") {
              const result = await applyInventoryUpdate({
                userPhone,
                parsed: parsedInventoryFromCaption,
                source: "voice",
                rawInput: bodyText
              });

              if (result.crossedLowThreshold) {
                await sendLowStockNotification({ userPhone, item: result.item });
              }

              return res.type("text/xml").send(twilioXmlReply(formatInventorySavedMessage(result)));
            }

            if (parsedInventoryFromCaption.action === "set-threshold") {
              const result = await setInventoryThreshold({
                userPhone,
                parsed: parsedInventoryFromCaption,
                source: "voice",
                rawInput: bodyText
              });

              return res.type("text/xml").send(twilioXmlReply(formatInventoryThresholdMessage(result)));
            }
          }

          const quotaMessage =
            error?.status === 429
              ? "Voice note uploaded, but NVIDIA API quota/rate limit is exhausted. Add a text caption like 'spent 500 fuel' with the voice note for fallback save."
              : "Voice note uploaded, but transcription failed. Add a text caption like 'spent 500 fuel' for immediate save.";

          return res.type("text/xml").send(twilioXmlReply(quotaMessage));
        }
      }

      try {
        const parsedDoc = await analyzeDocumentWithNvidia(downloaded.buffer, downloaded.mimeType, kind);
        const document = await Document.create({
          userPhone,
          kind,
          fileName: downloaded.fileName,
          mimeType: downloaded.mimeType,
          filePath: downloaded.filePath,
          extractedText: parsedDoc.extractedText || "",
          aiSummary: parsedDoc.summary || "",
          parsedData: parsedDoc
        });

        if (parsedDoc.transaction?.amount) {
          await saveTransaction({
            userPhone,
            source: kind === "bill" ? "bill" : "receipt",
            parsed: parsedDoc.transaction,
            rawInput: parsedDoc.extractedText || "",
            documentId: document._id
          });
        }

        return res.type("text/xml").send(
          twilioXmlReply(
            `Document processed. ${parsedDoc.transaction?.amount ? `Transaction saved: INR ${parsedDoc.transaction.amount}` : "No transaction amount found."}`
          )
        );
      } catch (error) {
        const localText = await extractTextFromDocumentLocally({
          buffer: downloaded.buffer,
          mimeType: downloaded.mimeType,
          fileName: downloaded.fileName
        });
        const localParsed = parseTransactionFallback(`${bodyText} ${localText}`.trim(), {
          strictAmountHints: true
        });
        const hasLocalAmount = Number(localParsed.amount) > 0;

        const document = await Document.create({
          userPhone,
          kind,
          fileName: downloaded.fileName,
          mimeType: downloaded.mimeType,
          filePath: downloaded.filePath,
          extractedText: localText,
          aiSummary: hasLocalAmount
            ? `AI unavailable; processed via local OCR/parser fallback. Original AI error: ${error.message}`
            : `Document saved but AI processing failed: ${error.message}`,
          parsedData: hasLocalAmount ? { transaction: localParsed, mode: "local-fallback" } : {}
        });

        if (hasLocalAmount) {
          await saveTransaction({
            userPhone,
            source: kind === "bill" ? "bill" : "receipt",
            parsed: localParsed,
            rawInput: localText || bodyText,
            documentId: document._id
          });

          return res
            .type("text/xml")
            .send(
              twilioXmlReply(
                `Document processed via local OCR fallback. Transaction saved: INR ${localParsed.amount} as ${localParsed.category}.`
              )
            );
        }

        const quotaMessage =
          error?.status === 429
            ? "Receipt/Bill uploaded, but AI quota is exhausted and no amount was detected locally. Add a caption like 'spent 950 grocery gst 5%' while uploading."
            : "Receipt/Bill uploaded, but AI could not process it now. Please retry.";

        return res.type("text/xml").send(twilioXmlReply(quotaMessage));
      }
    }

    if (normalized === "help") {
      return res.type("text/xml").send(twilioXmlReply(buildHelpText()));
    }

    if (normalized === "khata" || normalized === "khata summary") {
      const summary = await getKhataSummary({ userPhone });
      return res.type("text/xml").send(twilioXmlReply(formatKhataSummaryMessage(summary)));
    }

    if (normalized === "inventory" || normalized === "inventory summary" || normalized === "stock summary") {
      const summary = await getInventorySummary({ userPhone });
      return res.type("text/xml").send(twilioXmlReply(formatInventorySummaryMessage(summary)));
    }

    if (normalized === "low stock" || normalized === "inventory low" || normalized === "stock alert") {
      const summary = await getInventorySummary({ userPhone });
      if (!summary.lowStockItems.length) {
        return res.type("text/xml").send(twilioXmlReply("No low stock items right now."));
      }

      const lowMessage = formatInventorySummaryMessage({
        ...summary,
        items: summary.lowStockItems
      });
      return res.type("text/xml").send(twilioXmlReply(lowMessage));
    }

    if (normalized.startsWith("analysis")) {
      const period = parsePeriod(normalized);
      const analysis = await getAnalysis({ userPhone, period });
      const message = `Analysis (${analysis.from} to ${analysis.to})\nIncome: INR ${analysis.income.toFixed(2)}\nExpense: INR ${analysis.expense.toFixed(2)}\nSavings: INR ${analysis.savings.toFixed(2)}\nGST: INR ${analysis.totalGst.toFixed(2)}\nTransactions: ${analysis.count}`;
      return res.type("text/xml").send(twilioXmlReply(message));
    }

    if (normalized.startsWith("gst")) {
      const period = parsePeriod(normalized);
      const analysis = await getAnalysis({ userPhone, period });
      const pdfBuffer = await buildGstPdfBuffer({ userPhone, analysis });
      const fileName = `gst_${Date.now()}.pdf`;
      const filePath = `uploads/${fileName}`;
      await fs.writeFile(filePath, pdfBuffer);

      const downloadableUrl = env.publicBaseUrl
        ? `${env.publicBaseUrl.replace(/\/$/, "")}/uploads/${fileName}`
        : "";

      if (downloadableUrl) {
        return res
          .type("text/xml")
          .send(twilioXmlReply(`GST PDF generated for ${period}. Download: ${downloadableUrl}`, downloadableUrl));
      }

      return res
        .type("text/xml")
        .send(
          twilioXmlReply(
            `GST PDF generated for ${period}. Set PUBLIC_BASE_URL to receive a direct downloadable link in WhatsApp.`
          )
        );
    }

    const parsedKhata = parseKhataMessage(bodyText);
    if (parsedKhata) {
      await createKhataEntry({
        userPhone,
        parsed: parsedKhata,
        source: "text",
        rawInput: bodyText,
        entryDate: new Date()
      });

      return res.type("text/xml").send(twilioXmlReply(formatKhataSavedMessage(parsedKhata)));
    }

    const parsedInventory = parseInventoryMessage(bodyText);
    if (parsedInventory) {
      if (parsedInventory.action === "item-summary") {
        const item = await getInventoryItem({ userPhone, itemKey: parsedInventory.itemKey });
        return res.type("text/xml").send(twilioXmlReply(formatInventoryItemMessage(item)));
      }

      if (parsedInventory.action === "summary") {
        const summary = await getInventorySummary({ userPhone });
        return res.type("text/xml").send(twilioXmlReply(formatInventorySummaryMessage(summary)));
      }

      if (parsedInventory.action === "low-stock") {
        const summary = await getInventorySummary({ userPhone });
        if (!summary.lowStockItems.length) {
          return res.type("text/xml").send(twilioXmlReply("No low stock items right now."));
        }

        const lowMessage = formatInventorySummaryMessage({
          ...summary,
          items: summary.lowStockItems
        });
        return res.type("text/xml").send(twilioXmlReply(lowMessage));
      }

      if (parsedInventory.action === "update") {
        const result = await applyInventoryUpdate({
          userPhone,
          parsed: parsedInventory,
          source: "text",
          rawInput: bodyText
        });

        if (result.crossedLowThreshold) {
          await sendLowStockNotification({ userPhone, item: result.item });
        }

        return res.type("text/xml").send(twilioXmlReply(formatInventorySavedMessage(result)));
      }

      if (parsedInventory.action === "set-threshold") {
        const result = await setInventoryThreshold({
          userPhone,
          parsed: parsedInventory,
          source: "text",
          rawInput: bodyText
        });

        return res.type("text/xml").send(twilioXmlReply(formatInventoryThresholdMessage(result)));
      }
    }

    const parsed = await extractTransactionFromText(bodyText);
    await saveTransaction({ userPhone, source: "text", parsed, rawInput: bodyText });

    return res
      .type("text/xml")
      .send(twilioXmlReply(`Transaction saved: INR ${parsed.amount} as ${parsed.category}.`));
  } catch (error) {
    console.error("Twilio webhook error", error);
    return res
      .type("text/xml")
      .send(twilioXmlReply("Could not process request. Try again or send 'help'."));
  }
};

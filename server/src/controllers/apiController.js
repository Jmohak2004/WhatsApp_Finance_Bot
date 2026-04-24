import fs from "fs";
import path from "path";
import { Document } from "../models/Document.js";
import { Transaction } from "../models/Transaction.js";
import { analyzeDocumentWithNvidia, extractTransactionFromText } from "../services/nvidiaService.js";
import { getAnalysis } from "../services/analysisService.js";
import { buildGstPdfBuffer } from "../services/pdfService.js";
import {
  createKhataEntryFromText,
  getKhataEntries,
  getKhataSummary,
  parseKhataMessage
} from "../services/khataService.js";
import {
  applyInventoryUpdate,
  getInventoryItem,
  getInventorySummary,
  normalizeInventoryItemKey,
  parseInventoryMessage,
  sendDailyLowStockReminders,
  setInventoryThreshold
} from "../services/inventoryService.js";
import { sendTemplateMessage } from "../services/twilioService.js";

export const createTransaction = async (req, res) => {
  try {
    const { userPhone, text } = req.body;

    if (!userPhone || !text) {
      return res.status(400).json({ message: "userPhone and text are required" });
    }

    const parsed = await extractTransactionFromText(text);

    const tx = await Transaction.create({
      userPhone,
      source: "manual",
      type: parsed.type,
      amount: Number(parsed.amount || 0),
      category: parsed.category || "Other",
      description: parsed.description || "",
      merchant: parsed.merchant || "",
      transactionDate: parsed.transactionDate ? new Date(parsed.transactionDate) : new Date(),
      gstRate: Number(parsed.gstRate || 0),
      gstAmount: Number(parsed.gstAmount || 0),
      rawInput: text
    });

    return res.status(201).json(tx);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to create transaction" });
  }
};

export const getTransactions = async (req, res) => {
  try {
    const { userPhone } = req.query;

    if (!userPhone) {
      return res.status(400).json({ message: "userPhone query is required" });
    }

    const transactions = await Transaction.find({ userPhone }).sort({ transactionDate: -1 }).limit(500);
    return res.json(transactions);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to fetch transactions" });
  }
};

export const uploadDocument = async (req, res) => {
  try {
    const { userPhone, kind = "other" } = req.body;

    if (!req.file || !userPhone) {
      return res.status(400).json({ message: "file and userPhone are required" });
    }

    const parsedDoc = await analyzeDocumentWithNvidia(req.file.buffer, req.file.mimetype, kind);

    const doc = await Document.create({
      userPhone,
      kind,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      filePath: "",
      extractedText: parsedDoc.extractedText || "",
      aiSummary: parsedDoc.summary || "",
      parsedData: parsedDoc
    });

    let tx = null;
    if (parsedDoc.transaction?.amount) {
      tx = await Transaction.create({
        userPhone,
        source: kind === "bill" ? "bill" : "receipt",
        type: parsedDoc.transaction.type,
        amount: Number(parsedDoc.transaction.amount || 0),
        category: parsedDoc.transaction.category || "Other",
        description: parsedDoc.transaction.description || "",
        merchant: parsedDoc.transaction.merchant || "",
        transactionDate: parsedDoc.transaction.transactionDate
          ? new Date(parsedDoc.transaction.transactionDate)
          : new Date(),
        gstRate: Number(parsedDoc.transaction.gstRate || 0),
        gstAmount: Number(parsedDoc.transaction.gstAmount || 0),
        rawInput: parsedDoc.extractedText || "",
        documentId: doc._id
      });
    }

    return res.status(201).json({ doc, tx });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to analyze document" });
  }
};

export const getAnalysisReport = async (req, res) => {
  try {
    const { userPhone, period = "month" } = req.query;

    if (!userPhone) {
      return res.status(400).json({ message: "userPhone query is required" });
    }

    const analysis = await getAnalysis({ userPhone, period });
    return res.json(analysis);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to generate analysis" });
  }
};

export const downloadGstPdf = async (req, res) => {
  try {
    const { userPhone, period = "month" } = req.query;

    if (!userPhone) {
      return res.status(400).json({ message: "userPhone query is required" });
    }

    const analysis = await getAnalysis({ userPhone, period });
    const pdfBuffer = await buildGstPdfBuffer({ userPhone, analysis });
    const filename = `gst-report-${period}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
    return res.send(pdfBuffer);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to generate GST PDF" });
  }
};

export const getStoredGstPdfs = async (req, res) => {
  try {
    const uploadsPath = path.resolve(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsPath)) {
      return res.json([]);
    }

    const files = fs
      .readdirSync(uploadsPath)
      .filter((name) => name.startsWith("gst_") && name.endsWith(".pdf"))
      .sort()
      .reverse();

    return res.json(files);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to fetch gst files" });
  }
};

export const sendWhatsAppTemplate = async (req, res) => {
  try {
    const { to, contentSid, contentVariables = {}, from } = req.body;

    const message = await sendTemplateMessage({
      to,
      contentSid,
      contentVariables,
      from
    });

    return res.status(201).json({
      sid: message.sid,
      status: message.status,
      to: message.to,
      from: message.from
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Failed to send WhatsApp template message",
      error: error.message
    });
  }
};

export const createKhata = async (req, res) => {
  try {
    const { userPhone, text, source = "manual" } = req.body;

    if (!userPhone || !text) {
      return res.status(400).json({ message: "userPhone and text are required" });
    }

    const parsed = parseKhataMessage(text);
    if (!parsed) {
      return res.status(400).json({
        message: "Could not parse khata entry. Example: 'I sent 500 to Rahul'"
      });
    }

    const { entry } = await createKhataEntryFromText({ userPhone, text, source });
    return res.status(201).json({ entry, parsed });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to create khata entry" });
  }
};

export const listKhata = async (req, res) => {
  try {
    const { userPhone, limit = 200 } = req.query;

    if (!userPhone) {
      return res.status(400).json({ message: "userPhone query is required" });
    }

    const entries = await getKhataEntries({ userPhone, limit: Number(limit) });
    return res.json(entries);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to fetch khata entries" });
  }
};

export const khataSummary = async (req, res) => {
  try {
    const { userPhone } = req.query;

    if (!userPhone) {
      return res.status(400).json({ message: "userPhone query is required" });
    }

    const summary = await getKhataSummary({ userPhone });
    return res.json(summary);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to generate khata summary" });
  }
};

export const createInventoryUpdate = async (req, res) => {
  try {
    const { userPhone, text, source = "manual" } = req.body;

    if (!userPhone || !text) {
      return res.status(400).json({ message: "userPhone and text are required" });
    }

    const parsed = parseInventoryMessage(text);
    if (!parsed || (parsed.action !== "update" && parsed.action !== "set-threshold")) {
      return res.status(400).json({
        message:
          "Could not parse inventory command. Examples: 'add 250 soaps', 'sent 80 soaps', 'threshold soaps 120'"
      });
    }

    if (parsed.action === "set-threshold") {
      const result = await setInventoryThreshold({
        userPhone,
        parsed,
        source,
        rawInput: text
      });

      return res.status(201).json(result);
    }

    const result = await applyInventoryUpdate({
      userPhone,
      parsed,
      source,
      rawInput: text
    });

    return res.status(201).json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to update inventory" });
  }
};

export const inventorySummary = async (req, res) => {
  try {
    const { userPhone } = req.query;

    if (!userPhone) {
      return res.status(400).json({ message: "userPhone query is required" });
    }

    const summary = await getInventorySummary({ userPhone });
    return res.json(summary);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to get inventory summary" });
  }
};

export const inventoryItem = async (req, res) => {
  try {
    const { userPhone, item } = req.query;

    if (!userPhone || !item) {
      return res.status(400).json({ message: "userPhone and item query are required" });
    }

    const itemKey = normalizeInventoryItemKey(item);
    if (!itemKey) {
      return res.status(400).json({ message: "Invalid inventory item name" });
    }

    const found = await getInventoryItem({ userPhone, itemKey });
    if (!found) {
      return res.status(404).json({ message: "Inventory item not found" });
    }

    return res.json(found);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to get inventory item" });
  }
};

export const runDailyInventoryReminder = async (_req, res) => {
  try {
    const result = await sendDailyLowStockReminders();
    return res.json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to run daily low-stock reminders" });
  }
};

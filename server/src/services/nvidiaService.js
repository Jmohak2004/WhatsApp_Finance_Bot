import { env } from "../config/env.js";
import { extractJson } from "../utils/json.js";
import { extractTextFromDocumentLocally } from "./localExtractionService.js";

const nvidiaBaseUrl = () => (env.nvidiaBaseUrl || "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");

let resolvedChatModel = "";

const getChatModelCandidates = () => {
  const configured = [
    resolvedChatModel,
    env.nvidiaModel,
    env.nvidiaFallbackModel,
    "meta/llama-3.1-8b-instruct"
  ].filter(Boolean);

  return [...new Set(configured)];
};

const callNvidiaChat = async (prompt, options = {}) => {
  if (!env.nvidiaApiKey) {
    throw new Error("NVIDIA_API_KEY is missing in environment");
  }

  const errors = [];
  for (const model of getChatModelCandidates()) {
    const response = await fetch(`${nvidiaBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.nvidiaApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "You are a finance extraction assistant. Return strict JSON when requested."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? 1200,
        top_p: 1
      })
    });

    const payloadText = await response.text();
    if (!response.ok) {
      errors.push(`${model}: ${response.status} ${payloadText.slice(0, 120)}`);
      continue;
    }

    let payload;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      errors.push(`${model}: non-JSON response payload`);
      continue;
    }

    const content = payload?.choices?.[0]?.message?.content;
    const text = Array.isArray(content)
      ? content
          .map((part) => (typeof part === "string" ? part : part?.text || ""))
          .join(" ")
          .trim()
      : String(content || "").trim();

    if (!text) {
      errors.push(`${model}: empty content`);
      continue;
    }

    resolvedChatModel = model;
    return text;
  }

  throw new Error(`NVIDIA chat failed for all models: ${errors.join(" | ").slice(0, 700)}`);
};

export const extractTransactionFromText = async (text) => {
  const prompt = `Extract transaction details from user text.
Return strict JSON only with keys:
{
  "type": "expense|income",
  "amount": number,
  "category": string,
  "description": string,
  "merchant": string,
  "transactionDate": "YYYY-MM-DD",
  "gstRate": number,
  "gstAmount": number
}
Rules:
- If date missing, use today's date.
- If GST missing, set gstRate=0 and gstAmount=0.
- Keep description short.
- Do not include markdown.
Input: ${text}`;

  try {
    const output = await callNvidiaChat(prompt, { temperature: 0, maxTokens: 800 });
    const parsed = extractJson(output);

    if (!parsed || !parsed.amount || !parsed.type) {
      throw new Error("Could not parse transaction from NVIDIA response");
    }

    return parsed;
  } catch (error) {
    const fallback = parseTransactionFallback(text);
    if (!fallback.amount) {
      throw error;
    }
    return fallback;
  }
};

export const analyzeDocumentWithNvidia = async (buffer, mimeType, kind = "receipt") => {
  const extractedText = await extractTextFromDocumentLocally({
    buffer,
    mimeType,
    fileName: `${kind}.${mimeType.split("/")[1] || "bin"}`
  });

  if (!extractedText) {
    throw new Error("No text extracted from document");
  }

  const prompt = `You are an invoice/receipt analyzer for Indian accounting and GST.
Using the OCR text below, return strict JSON only:
{
  "summary": string,
  "extractedText": string,
  "transaction": {
    "type": "expense|income",
    "amount": number,
    "category": string,
    "description": string,
    "merchant": string,
    "transactionDate": "YYYY-MM-DD",
    "gstRate": number,
    "gstAmount": number
  },
  "gst": {
    "supplierName": string,
    "gstin": string,
    "taxableValue": number,
    "cgst": number,
    "sgst": number,
    "igst": number,
    "totalTax": number,
    "invoiceNumber": string,
    "invoiceDate": "YYYY-MM-DD"
  }
}
Rules:
- Fill unknown numeric values as 0.
- Fill unknown strings as empty string.
- Strict JSON only.
- Document type: ${kind}.
OCR text:
${extractedText}`;

  try {
    const output = await callNvidiaChat(prompt, { temperature: 0, maxTokens: 1800 });
    const parsed = extractJson(output);

    if (!parsed) {
      throw new Error("Could not parse document from NVIDIA response");
    }

    if (!parsed.extractedText) {
      parsed.extractedText = extractedText;
    }

    if (!parsed.transaction) {
      parsed.transaction = parseTransactionFallback(extractedText, { strictAmountHints: true });
    }

    const inferredType = inferTransactionTypeFromText(
      `${parsed.extractedText || ""}\n${parsed.summary || ""}`
    );

    if (inferredType) {
      parsed.transaction.type = inferredType;
    } else if (kind === "bill") {
      parsed.transaction.type = "expense";
    } else if (!parsed.transaction.type) {
      parsed.transaction.type = "expense";
    }

    return parsed;
  } catch (error) {
    const fallbackTx = parseTransactionFallback(extractedText, { strictAmountHints: true });
    const inferredType = inferTransactionTypeFromText(extractedText);

    if (inferredType) {
      fallbackTx.type = inferredType;
    } else if (kind === "bill") {
      fallbackTx.type = "expense";
    } else if (!fallbackTx.type) {
      fallbackTx.type = "expense";
    }

    if (!fallbackTx.amount) {
      throw error;
    }

    return {
      summary: `Processed from OCR using parser fallback. NVIDIA parse error: ${error.message}`.slice(0, 240),
      extractedText,
      transaction: fallbackTx,
      gst: {
        supplierName: "",
        gstin: "",
        taxableValue: fallbackTx.amount,
        cgst: 0,
        sgst: 0,
        igst: 0,
        totalTax: fallbackTx.gstAmount || 0,
        invoiceNumber: "",
        invoiceDate: fallbackTx.transactionDate
      }
    };
  }
};

export const transcribeAudioWithNvidia = async (buffer, mimeType, fileName = "voice_note.ogg") => {
  if (!env.nvidiaApiKey) {
    throw new Error("NVIDIA_API_KEY is missing in environment");
  }

  const formData = new FormData();
  formData.append("model", env.nvidiaTranscriptionModel);
  formData.append("response_format", "text");
  formData.append("file", new Blob([buffer], { type: mimeType || "audio/ogg" }), fileName);

  const response = await fetch(`${nvidiaBaseUrl()}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.nvidiaApiKey}`
    },
    body: formData
  });

  const payloadText = await response.text();
  if (!response.ok) {
    throw new Error(`NVIDIA transcription failed (${response.status}): ${payloadText.slice(0, 280)}`);
  }

  const trimmed = payloadText.trim();
  if (!trimmed) {
    throw new Error("NVIDIA transcription returned empty text");
  }

  try {
    const payload = JSON.parse(trimmed);
    const text = String(payload.text || payload.transcript || payload.output || "").trim();
    if (text) {
      return text;
    }
  } catch {
    // Plain-text response is valid for response_format=text.
  }

  return trimmed;
};

export const inferTransactionTypeFromText = (text) => {
  const cleaned = String(text || "").toLowerCase();
  if (!cleaned) return "";

  const incomePatterns = [
    /\b(received|money\s+received|payment\s+received|credited|credit\s+alert|salary\s+credited|collect\s+request\s+paid)\b/i,
    /\b(received\s+from|from\s+[a-z0-9 .'-]{2,40}\s+via\s+upi)\b/i,
    /(?:\+\s*(?:inr|rs\.?|\u20B9)?\s*\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?)/i,
    /\b(?:a\/c|account)\s+credited\b/i,
    /\bcr\b/i
  ];

  const expensePatterns = [
    /\b(sent|paid\s+to|debited|money\s+sent|upi\s+payment|transferred\s+to|purchase|spent|bill\s+paid)\b/i,
    /(?:-\s*(?:inr|rs\.?|\u20B9)?\s*\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?)/i,
    /\b(?:a\/c|account)\s+debited\b/i,
    /\bdr\b/i
  ];

  const incomeScore = incomePatterns.reduce((score, regex) => score + (regex.test(cleaned) ? 1 : 0), 0);
  const expenseScore = expensePatterns.reduce((score, regex) => score + (regex.test(cleaned) ? 1 : 0), 0);

  if (incomeScore > expenseScore && incomeScore > 0) return "income";
  if (expenseScore > incomeScore && expenseScore > 0) return "expense";

  if (/\b(gpay|google\s*pay|upi)\b/i.test(cleaned) && /\b(received|credited)\b/i.test(cleaned)) {
    return "income";
  }

  return "";
};

export const parseTransactionFallback = (text, options = {}) => {
  const normalizedText = normalizeReceiptText(String(text || ""));
  const cleaned = normalizedText.toLowerCase();
  const amount = extractBestAmount(cleaned, Boolean(options.strictAmountHints));
  const type = inferTransactionTypeFromText(cleaned) || "expense";

  const categoryMap = [
    { key: "fuel", value: "Fuel" },
    { key: "petrol", value: "Fuel" },
    { key: "diesel", value: "Fuel" },
    { key: "grocery", value: "Groceries" },
    { key: "groceries", value: "Groceries" },
    { key: "supermarket", value: "Groceries" },
    { key: "food", value: "Food" },
    { key: "restaurant", value: "Food" },
    { key: "dining", value: "Food" },
    { key: "rent", value: "Rent" },
    { key: "electricity", value: "Utilities" },
    { key: "water", value: "Utilities" },
    { key: "internet", value: "Utilities" },
    { key: "utility", value: "Utilities" },
    { key: "travel", value: "Travel" },
    { key: "uber", value: "Travel" },
    { key: "ola", value: "Travel" },
    { key: "salary", value: "Salary" },
    { key: "medicine", value: "Healthcare" },
    { key: "pharmacy", value: "Healthcare" }
  ];

  const categoryHit = categoryMap.find((item) => cleaned.includes(item.key));
  const category = categoryHit ? categoryHit.value : "Other";

  const gstRate = extractGstRate(cleaned);
  const gstAmount = extractGstAmount(cleaned, amount, gstRate);
  const merchant = extractMerchant(normalizedText);

  return {
    type,
    amount,
    category,
    description: normalizedText.slice(0, 180),
    merchant,
    transactionDate: new Date().toISOString().slice(0, 10),
    gstRate,
    gstAmount: Number(gstAmount.toFixed(2))
  };
};

const normalizeReceiptText = (text) => {
  return String(text || "")
    .replace(/_/g, ".")
    .replace(/(^|[^\d])[oO](\d)/g, "$10$2")
    .replace(/(\d)[oO]([^\d]|$)/g, "$10$2")
    .replace(/\b[oO]\.([0-9]{2})\b/g, "0.$1")
    .replace(/\bcoo\b/gi, "0.00")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
};

const moneyRegex = /((?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?)/g;

const parseMoney = (raw) => {
  const value = Number(String(raw || "").replace(/,/g, ""));
  return Number.isFinite(value) ? value : 0;
};

const extractBestAmount = (text, strictAmountHints = false) => {
  const candidates = [];

  for (const match of text.matchAll(moneyRegex)) {
    const raw = match[1];
    const value = parseMoney(raw);
    if (!value || value <= 0 || value > 100000000) {
      continue;
    }

    const index = match.index || 0;
    const context = text.slice(Math.max(0, index - 28), Math.min(text.length, index + raw.length + 28));
    let score = 0;

    if (/(grand\s*total|net\s*amount|amount\s*payable|total\s*amount|bill\s*amount|total)/i.test(context)) {
      score += 8;
    }
    if (/(inr|rs\.?|rupees)/i.test(context)) {
      score += 5;
    }
    if (/(spent|pay|paid|debited|expense|purchased|bought|cost|purchase)/i.test(context)) {
      score += 4;
    }
    if (/(received|credited|salary|income)/i.test(context)) {
      score += 3;
    }
    if (/(invoice|inv\s*no|bill\s*no|order|qty|quantity|hsn|gstin|phone|mobile|pin|table|token|date|time)/i.test(context)) {
      score -= 6;
    }
    if (/(gst|cgst|sgst|igst|tax)/i.test(context)) {
      score -= 2;
    }
    if (raw.includes(".")) {
      score += 1;
    }
    if (value < 10) {
      score -= 3;
    }
    if (value >= 1900 && value <= 2100) {
      if (/(date|period|year|fy|from|to|\d{4}[-/]\d{1,2}[-/]\d{1,2})/i.test(context)) {
        score -= 10;
      } else {
        score -= 2;
      }
    }

    const prevChar = text[index - 1] || "";
    const nextChar = text[index + raw.length] || "";
    if ((prevChar === "-" || prevChar === "/" || nextChar === "-" || nextChar === "/") && value <= 31) {
      score -= 8;
    }

    candidates.push({ value, score });
  }

  if (!candidates.length) {
    return 0;
  }

  candidates.sort((a, b) => b.score - a.score || b.value - a.value);
  const best = candidates[0];

  if (strictAmountHints && best.score < 2) {
    return 0;
  }

  if (best.score < 0) {
    if (strictAmountHints) {
      return 0;
    }

    const viable = candidates
      .filter((item) => item.score >= -1)
      .map((item) => item.value)
      .filter((value) => value > 0);

    if (!viable.length) {
      return 0;
    }

    return Number(Math.max(...viable).toFixed(2));
  }

  return Number(best.value.toFixed(2));
};

const extractGstRate = (text) => {
  const rates = [];

  for (const match of text.matchAll(/\b(?:gst|cgst|sgst|igst)\b[^\d]{0,14}(\d+(?:\.\d+)?)\s*%/gi)) {
    rates.push(Number(match[1]));
  }
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*%[^\n]{0,14}\b(?:gst|cgst|sgst|igst)\b/gi)) {
    rates.push(Number(match[1]));
  }

  const valid = rates.filter((rate) => Number.isFinite(rate) && rate >= 0 && rate <= 40);
  return valid.length ? Math.max(...valid) : 0;
};

const extractGstAmount = (text, amount, gstRate) => {
  const components = [];

  for (const match of text.matchAll(/\b(?:cgst|sgst|igst|gst)\b[^\d%]{0,20}((?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?)/gi)) {
    const value = parseMoney(match[1]);
    if (value > 0 && (!amount || value <= amount)) {
      components.push(value);
    }
  }

  if (components.length) {
    const total = components.reduce((sum, value) => sum + value, 0);
    if (amount && total > amount) {
      return Math.min(...components);
    }
    return total;
  }

  if (gstRate > 0 && amount > 0) {
    return (amount * gstRate) / (100 + gstRate);
  }

  return 0;
};

const extractMerchant = (text) => {
  const lines = String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines.slice(0, 8)) {
    if (line.length < 3) {
      continue;
    }
    if (/(invoice|receipt|bill|date|total|amount|gst|tax|phone|mobile|qty|hsn|cash|card)/i.test(line)) {
      continue;
    }

    const cleaned = line.replace(/[^a-zA-Z0-9&.,'\- ]/g, "").trim();
    if (cleaned && /[a-zA-Z]/.test(cleaned)) {
      return cleaned.slice(0, 64);
    }
  }

  return "";
};

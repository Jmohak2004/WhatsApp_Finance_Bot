import { env } from "../config/env.js";

const OCR_SPACE_URL = "https://api.ocr.space/parse/image";

export const extractTextFromDocumentLocally = async ({ buffer, mimeType, fileName = "upload" }) => {
  if (!buffer || !mimeType) {
    return "";
  }

  if (!mimeType.startsWith("image/") && !mimeType.includes("pdf")) {
    return "";
  }

  try {
    const formData = new FormData();
    formData.append("apikey", env.ocrSpaceApiKey || "helloworld");
    formData.append("language", "eng");
    formData.append("isOverlayRequired", "false");
    formData.append("OCREngine", "2");
    formData.append("scale", "true");
    formData.append("detectOrientation", "true");
    formData.append("file", new Blob([buffer], { type: mimeType }), fileName);

    const response = await fetch(OCR_SPACE_URL, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      throw new Error(`OCR API request failed with ${response.status}`);
    }

    const payload = await response.json();
    if (payload.IsErroredOnProcessing) {
      throw new Error(payload.ErrorMessage?.join(" ") || "OCR processing failed");
    }

    const text = (payload.ParsedResults || []).map((entry) => entry.ParsedText || "").join("\n").trim();
    return normalizeOcrText(text);
  } catch (error) {
    console.warn("Local OCR fallback failed", error.message);
    return "";
  }
};

const normalizeOcrText = (text) => {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
};

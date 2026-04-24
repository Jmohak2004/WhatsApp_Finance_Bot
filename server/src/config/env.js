import dotenv from "dotenv";

dotenv.config();

const parseBoolean = (value, defaultValue = false) => {
  if (value === undefined) return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
};

export const env = {
  port: Number(process.env.PORT || 5000),
  mongoUri: process.env.MONGO_URI,
  nvidiaApiKey: process.env.NVIDIA_API_KEY,
  nvidiaModel: process.env.NVIDIA_MODEL || "gemma-4",
  nvidiaFallbackModel: process.env.NVIDIA_FALLBACK_MODEL || "meta/llama-3.1-8b-instruct",
  nvidiaBaseUrl: process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1",
  nvidiaTranscriptionModel: process.env.NVIDIA_TRANSCRIPTION_MODEL || "nvidia/parakeet-tdt-0.6b-v2",
  ocrSpaceApiKey: process.env.OCR_SPACE_API_KEY || "",
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioMediaAccountSid: process.env.TWILIO_MEDIA_ACCOUNT_SID || "",
  twilioMediaAuthToken: process.env.TWILIO_MEDIA_AUTH_TOKEN || "",
  twilioWhatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER,
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  dailyLowStockReminderEnabled: parseBoolean(process.env.DAILY_LOW_STOCK_REMINDER_ENABLED, true),
  dailyLowStockReminderIntervalMinutes: Number(process.env.DAILY_LOW_STOCK_REMINDER_INTERVAL_MINUTES || 60)
};

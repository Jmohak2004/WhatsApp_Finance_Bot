import axios from "axios";
import path from "path";
import fs from "fs/promises";
import { env } from "../config/env.js";

const extractAccountSidFromMediaUrl = (mediaUrl = "") => {
  const match = String(mediaUrl).match(/\/Accounts\/(AC[a-zA-Z0-9]{32})\//i);
  return match?.[1] || "";
};

const uniqueNonEmpty = (items = []) => {
  return [...new Set(items.filter(Boolean))];
};

export const downloadTwilioMedia = async (mediaUrl, targetDir = "uploads", authOverrides = {}) => {
  if (!mediaUrl) {
    throw new Error("Twilio media URL is missing");
  }

  const mediaAccountSid = extractAccountSidFromMediaUrl(mediaUrl);
  const sidCandidates = uniqueNonEmpty([
    authOverrides.accountSid,
    mediaAccountSid,
    env.twilioMediaAccountSid,
    env.twilioAccountSid
  ]);
  const tokenCandidates = uniqueNonEmpty([
    authOverrides.authToken,
    env.twilioMediaAuthToken,
    env.twilioAuthToken
  ]);

  if (!sidCandidates.length || !tokenCandidates.length) {
    throw new Error("Twilio credentials are missing. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.");
  }

  let response = null;
  let lastError = null;
  let attemptedCombos = [];

  for (const sid of sidCandidates) {
    for (const token of tokenCandidates) {
      attemptedCombos.push(`${sid}/token`);
      try {
        response = await axios.get(mediaUrl, {
          responseType: "arraybuffer",
          auth: {
            username: sid,
            password: token
          }
        });
        break;
      } catch (error) {
        lastError = error;
        if (error?.response?.status !== 401) {
          throw error;
        }
      }
    }

    if (response) {
      break;
    }
  }

  if (!response) {
    if (lastError?.response?.status === 401) {
      const error = new Error(
        `Twilio media auth failed (401). Tried credential combinations: ${attemptedCombos.join(", ")}`
      );
      error.code = "TWILIO_MEDIA_AUTH_FAILED";
      error.status = 401;
      throw error;
    }

    throw lastError || new Error("Failed to download Twilio media");
  }

  const contentType = response.headers["content-type"] || "application/octet-stream";
  const ext = contentType.split("/")[1]?.split(";")[0] || "bin";
  const fileName = `twilio_${Date.now()}.${ext}`;
  const absolutePath = path.resolve(process.cwd(), targetDir, fileName);

  await fs.writeFile(absolutePath, response.data);

  return {
    fileName,
    mimeType: contentType,
    buffer: Buffer.from(response.data),
    filePath: absolutePath
  };
};

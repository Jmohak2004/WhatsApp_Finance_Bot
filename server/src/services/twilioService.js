import twilio from "twilio";
import { env } from "../config/env.js";

let twilioClient;

const getTwilioClient = () => {
  if (!env.twilioAccountSid || !env.twilioAuthToken) {
    throw new Error("Twilio credentials are missing in environment");
  }

  if (!twilioClient) {
    twilioClient = twilio(env.twilioAccountSid, env.twilioAuthToken);
  }

  return twilioClient;
};

export const sendTemplateMessage = async ({
  to,
  contentSid,
  contentVariables = {},
  from = env.twilioWhatsappNumber
}) => {
  if (!to || !contentSid) {
    throw new Error("to and contentSid are required");
  }

  const message = await getTwilioClient().messages.create({
    from,
    to,
    contentSid,
    contentVariables: JSON.stringify(contentVariables)
  });

  return message;
};

export const sendWhatsAppTextMessage = async ({ to, body, from = env.twilioWhatsappNumber }) => {
  if (!to || !body) {
    throw new Error("to and body are required");
  }

  const message = await getTwilioClient().messages.create({
    from,
    to,
    body
  });

  return message;
};

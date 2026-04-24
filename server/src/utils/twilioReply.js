import twilio from "twilio";

export const twilioXmlReply = (message, mediaUrl = "") => {
  const twiml = new twilio.twiml.MessagingResponse();
  const msg = twiml.message(message);
  if (mediaUrl) {
    msg.media(mediaUrl);
  }
  return twiml.toString();
};

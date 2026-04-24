import { Router } from "express";
import { twilioWebhook } from "../controllers/webhookController.js";

const router = Router();

router.post("/twilio/whatsapp", twilioWebhook);

export default router;

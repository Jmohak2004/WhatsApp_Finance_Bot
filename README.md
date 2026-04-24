# MERN WhatsApp Finance Bot (Twilio + NVIDIA)

This project provides a complete MERN app where you can:
- Send transactions over WhatsApp text
- Send voice notes for transaction logging
- Upload receipts/bills (image/PDF) for AI extraction
- Store udhaar/khata entries from natural language messages
- Manage inventory stock from WhatsApp messages
- Store all parsed data in MongoDB
- Generate analysis for week/month/year
- Export GST filing summary as PDF

## Stack
- Backend: Node.js, Express, MongoDB, Mongoose
- Frontend: React + Vite + Recharts
- Messaging: Twilio WhatsApp Webhook
- AI: NVIDIA API (model `gemma-4`), plus OCR fallback for docs
- PDF: PDFKit

## 1) Setup

### Backend env
Create `server/.env` from `server/.env.example` and fill:
- `MONGO_URI`
- `USE_IN_MEMORY_DB=false` (recommended for low-memory machines)
- `NVIDIA_API_KEY`
- `NVIDIA_MODEL` (set `gemma-4`)
- `NVIDIA_FALLBACK_MODEL` (recommended `meta/llama-3.1-8b-instruct`)
- `NVIDIA_BASE_URL` (default `https://integrate.api.nvidia.com/v1`)
- `NVIDIA_TRANSCRIPTION_MODEL` (for voice transcription endpoint)
- `OCR_SPACE_API_KEY` (use `helloworld` for quick testing)
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_NUMBER`
- `DAILY_LOW_STOCK_REMINDER_ENABLED` (default `true`)
- `DAILY_LOW_STOCK_REMINDER_INTERVAL_MINUTES` (default `60`)

### Frontend env
Create `client/.env` from `client/.env.example`.

## 2) Install

```bash
cd server && npm install
cd ../client && npm install
```

## 3) Run

```bash
# terminal 1
cd server && npm run dev

# terminal 2
cd client && npm run dev
```

Backend URL: `http://localhost:5000`
Frontend URL: `http://localhost:5173`

## 4) Twilio WhatsApp webhook
Set incoming webhook URL in Twilio sandbox/number:

```text
POST http://<your-public-url>/webhook/twilio/whatsapp
```

For local development use ngrok:

```bash
ngrok http 5000
```

Then use the ngrok URL in Twilio.

## 5) WhatsApp commands
- `help`
- Send plain transaction text, example: `Spent 850 on groceries today with 5% gst`
- Send a voice message with transaction details
- Send receipt or bill image/PDF
- `analysis week`
- `analysis month`
- `analysis year`
- `gst month`
- `I sent 1500 to Rahul` (khata save)
- `I borrowed 700 from Amit` (khata save)
- `khata` or `khata summary`
- `Rahul paid back 300` (khata settlement)
- `I paid back 200 to Rahul` (khata settlement)
- `add 250 soaps` (inventory add)
- `sent 80 soaps` (inventory remove)
- `threshold soaps 120` (set per-item low-stock threshold)
- `inventory summary`
- `low stock`

## 6) API endpoints
- `POST /api/transactions`
- `GET /api/transactions?userPhone=whatsapp:+91...`
- `POST /api/documents` (multipart, `file`)
- `GET /api/analysis?userPhone=...&period=month`
- `GET /api/gst/pdf?userPhone=...&period=month`
- `POST /api/whatsapp/send-template`
- `POST /api/khata` (body: `userPhone`, `text`)
- `GET /api/khata?userPhone=...`
- `GET /api/khata/summary?userPhone=...`
- `POST /api/inventory` (body: `userPhone`, `text`)
- `GET /api/inventory?userPhone=...`
- `GET /api/inventory/item?userPhone=...&item=soap`
- `POST /api/inventory/reminders/daily` (manual trigger for daily reminders)

Example request for template send:

```bash
curl -X POST http://localhost:5000/api/whatsapp/send-template \
	-H "Content-Type: application/json" \
	-d '{
		"to":"whatsapp:+917249011061",
		"contentSid":"HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
		"contentVariables":{"1":"12/1","2":"3pm"}
	}'
```

## Notes
- Voice processing quality depends on audio clarity.
- AI extraction can have occasional inaccuracies; always review GST fields before filing.
- This setup gives GST-ready summary PDF and transaction evidence from uploaded docs.
- Never hardcode API keys or Twilio tokens in source code. Keep them only in environment files.
- If NVIDIA quota/rate limit is exhausted, photo/PDF uploads are still auto-processed using OCR fallback.
- If NVIDIA transcription fails, voice notes require a short caption (example: "spent 500 fuel") for fallback save.
- Low stock alert is triggered when quantity crosses below threshold (default 100), and the bot sends a notification.
- Daily low-stock reminders are sent once per day per user for unresolved low-stock items.
- GPay/UPI screenshots with credit cues (for example: "money received", "credited", "+INR") are auto-classified as income.

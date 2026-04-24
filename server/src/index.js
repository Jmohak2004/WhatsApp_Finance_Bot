import express from "express";
import cors from "cors";
import morgan from "morgan";
import path from "path";
import fs from "fs";
import webhookRoutes from "./routes/webhookRoutes.js";
import apiRoutes from "./routes/apiRoutes.js";
import { env } from "./config/env.js";
import { connectDb } from "./config/db.js";
import { sendDailyLowStockReminders } from "./services/inventoryService.js";

const app = express();
let lowStockReminderTimer = null;

const uploadsPath = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

app.use(cors({ origin: env.clientUrl }));
app.use(morgan("dev"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/uploads", express.static(uploadsPath));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "finance-whatsapp-server" });
});

app.use("/webhook", webhookRoutes);
app.use("/api", apiRoutes);

const startDailyLowStockReminderScheduler = () => {
  if (!env.dailyLowStockReminderEnabled) {
    console.log("Daily low-stock reminder scheduler is disabled.");
    return;
  }

  const minutes = Number(env.dailyLowStockReminderIntervalMinutes || 60);
  const intervalMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 60;
  const intervalMs = intervalMinutes * 60 * 1000;

  const runJob = async () => {
    try {
      const result = await sendDailyLowStockReminders();
      if (result.remindersSent > 0) {
        console.log(
          `Daily low-stock reminders sent: ${result.remindersSent}/${result.usersWithReminders} user(s).`
        );
      }
    } catch (error) {
      console.error("Daily low-stock reminder job failed", error.message);
    }
  };

  runJob();
  lowStockReminderTimer = setInterval(runJob, intervalMs);
  if (typeof lowStockReminderTimer.unref === "function") {
    lowStockReminderTimer.unref();
  }

  console.log(`Daily low-stock reminder scheduler started. Interval: ${intervalMinutes} minute(s).`);
};

const start = async () => {
  await connectDb();
  startDailyLowStockReminderScheduler();
  app.listen(env.port, () => {
    console.log(`Server running on http://localhost:${env.port}`);
  });
};

start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});

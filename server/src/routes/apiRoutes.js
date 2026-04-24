import { Router } from "express";
import multer from "multer";
import {
  createKhata,
  createInventoryUpdate,
  createTransaction,
  downloadGstPdf,
  getAnalysisReport,
  khataSummary,
  inventoryItem,
  inventorySummary,
  runDailyInventoryReminder,
  listKhata,
  getStoredGstPdfs,
  getTransactions,
  sendWhatsAppTemplate,
  uploadDocument
} from "../controllers/apiController.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/transactions", createTransaction);
router.get("/transactions", getTransactions);
router.post("/documents", upload.single("file"), uploadDocument);
router.get("/analysis", getAnalysisReport);
router.get("/gst/pdf", downloadGstPdf);
router.get("/gst/files", getStoredGstPdfs);
router.post("/whatsapp/send-template", sendWhatsAppTemplate);
router.post("/khata", createKhata);
router.get("/khata", listKhata);
router.get("/khata/summary", khataSummary);
router.post("/inventory", createInventoryUpdate);
router.get("/inventory", inventorySummary);
router.get("/inventory/item", inventoryItem);
router.post("/inventory/reminders/daily", runDailyInventoryReminder);

export default router;

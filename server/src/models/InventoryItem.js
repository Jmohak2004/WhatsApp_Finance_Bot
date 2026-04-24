import mongoose from "mongoose";

const inventoryItemSchema = new mongoose.Schema(
  {
    userPhone: {
      type: String,
      required: true,
      index: true
    },
    itemKey: {
      type: String,
      required: true
    },
    itemName: {
      type: String,
      required: true
    },
    quantity: {
      type: Number,
      default: 0,
      min: 0
    },
    lowStockThreshold: {
      type: Number,
      default: 100,
      min: 0
    },
    unit: {
      type: String,
      default: "pcs"
    },
    alertEnabled: {
      type: Boolean,
      default: true
    },
    lastLowStockAlertSentAt: {
      type: Date,
      default: null
    },
    lastDailyReminderDate: {
      type: String,
      default: ""
    },
    lastUpdatedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

inventoryItemSchema.index({ userPhone: 1, itemKey: 1 }, { unique: true });

export const InventoryItem = mongoose.model("InventoryItem", inventoryItemSchema);

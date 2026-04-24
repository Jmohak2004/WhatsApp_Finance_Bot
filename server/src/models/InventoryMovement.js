import mongoose from "mongoose";

const inventoryMovementSchema = new mongoose.Schema(
  {
    userPhone: {
      type: String,
      required: true,
      index: true
    },
    itemKey: {
      type: String,
      required: true,
      index: true
    },
    itemName: {
      type: String,
      required: true
    },
    movementType: {
      type: String,
      enum: ["add", "remove", "set"],
      required: true
    },
    quantityChange: {
      type: Number,
      required: true
    },
    quantityAfter: {
      type: Number,
      required: true,
      min: 0
    },
    note: {
      type: String,
      default: ""
    },
    source: {
      type: String,
      enum: ["text", "voice", "manual"],
      default: "text"
    },
    rawInput: {
      type: String,
      default: ""
    }
  },
  {
    timestamps: true
  }
);

inventoryMovementSchema.index({ userPhone: 1, itemKey: 1, createdAt: -1 });

export const InventoryMovement = mongoose.model("InventoryMovement", inventoryMovementSchema);

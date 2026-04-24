import mongoose from "mongoose";

const khataEntrySchema = new mongoose.Schema(
  {
    userPhone: {
      type: String,
      required: true,
      index: true
    },
    counterpartyName: {
      type: String,
      required: true,
      index: true
    },
    direction: {
      type: String,
      enum: ["lent", "borrowed"],
      required: true
    },
    entryType: {
      type: String,
      enum: ["debt", "settlement"],
      default: "debt"
    },
    amount: {
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
    entryDate: {
      type: Date,
      default: Date.now
    },
    rawInput: {
      type: String,
      default: ""
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document"
    }
  },
  {
    timestamps: true
  }
);

khataEntrySchema.index({ userPhone: 1, counterpartyName: 1, entryDate: -1 });

export const KhataEntry = mongoose.model("KhataEntry", khataEntrySchema);

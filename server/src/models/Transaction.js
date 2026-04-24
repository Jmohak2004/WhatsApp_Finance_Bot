import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    userPhone: {
      type: String,
      required: true,
      index: true
    },
    source: {
      type: String,
      enum: ["text", "voice", "receipt", "bill", "manual"],
      required: true
    },
    type: {
      type: String,
      enum: ["expense", "income"],
      required: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    category: {
      type: String,
      default: "Other"
    },
    description: {
      type: String,
      default: ""
    },
    merchant: {
      type: String,
      default: ""
    },
    transactionDate: {
      type: Date,
      required: true
    },
    gstRate: {
      type: Number,
      default: 0
    },
    gstAmount: {
      type: Number,
      default: 0
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

export const Transaction = mongoose.model("Transaction", transactionSchema);

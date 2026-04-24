import mongoose from "mongoose";

const documentSchema = new mongoose.Schema(
  {
    userPhone: {
      type: String,
      required: true,
      index: true
    },
    kind: {
      type: String,
      enum: ["receipt", "bill", "voice", "other"],
      default: "other"
    },
    fileName: {
      type: String,
      required: true
    },
    mimeType: {
      type: String,
      required: true
    },
    filePath: {
      type: String,
      required: true
    },
    extractedText: {
      type: String,
      default: ""
    },
    aiSummary: {
      type: String,
      default: ""
    },
    parsedData: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

export const Document = mongoose.model("Document", documentSchema);

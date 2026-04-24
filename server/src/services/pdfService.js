import PDFDocument from "pdfkit";

export const buildGstPdfBuffer = async ({ userPhone, analysis }) => {
  const doc = new PDFDocument({ margin: 40 });
  const chunks = [];

  doc.on("data", (chunk) => chunks.push(chunk));

  const done = new Promise((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });

  doc.fontSize(20).text("GST Filing Summary", { align: "center" });
  doc.moveDown();
  doc.fontSize(11).text(`User: ${userPhone}`);
  doc.text(`Period: ${analysis.from} to ${analysis.to}`);
  doc.text(`Total Transactions: ${analysis.count}`);
  doc.text(`Total GST: INR ${analysis.totalGst.toFixed(2)}`);
  doc.text(`Total Expense: INR ${analysis.expense.toFixed(2)}`);
  doc.text(`Total Income: INR ${analysis.income.toFixed(2)}`);
  doc.moveDown();
  doc.fontSize(14).text("Transaction Entries", { underline: true });
  doc.moveDown(0.5);

  analysis.transactions.forEach((tx, index) => {
    doc
      .fontSize(10)
      .text(
        `${index + 1}. ${new Date(tx.transactionDate).toISOString().slice(0, 10)} | ${tx.type.toUpperCase()} | INR ${tx.amount.toFixed(2)} | GST: INR ${(tx.gstAmount || 0).toFixed(2)} | ${tx.category} | ${tx.description}`
      );
  });

  doc.end();
  await done;

  return Buffer.concat(chunks);
};

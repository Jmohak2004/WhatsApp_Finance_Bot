import dayjs from "dayjs";
import { Transaction } from "../models/Transaction.js";

const getRange = (period) => {
  const now = dayjs();

  switch (period) {
    case "week":
      return { from: now.subtract(7, "day").startOf("day"), to: now.endOf("day") };
    case "month":
      return { from: now.startOf("month"), to: now.endOf("month") };
    case "year":
      return { from: now.startOf("year"), to: now.endOf("year") };
    default:
      return { from: now.subtract(30, "day").startOf("day"), to: now.endOf("day") };
  }
};

export const getAnalysis = async ({ userPhone, period }) => {
  const { from, to } = getRange(period);

  const transactions = await Transaction.find({
    userPhone,
    transactionDate: {
      $gte: from.toDate(),
      $lte: to.toDate()
    }
  }).sort({ transactionDate: -1 });

  const income = transactions
    .filter((tx) => tx.type === "income")
    .reduce((sum, tx) => sum + tx.amount, 0);

  const expense = transactions
    .filter((tx) => tx.type === "expense")
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalGst = transactions.reduce((sum, tx) => sum + (tx.gstAmount || 0), 0);

  const categoryTotals = transactions.reduce((acc, tx) => {
    acc[tx.category] = (acc[tx.category] || 0) + tx.amount;
    return acc;
  }, {});

  return {
    period,
    from: from.format("YYYY-MM-DD"),
    to: to.format("YYYY-MM-DD"),
    count: transactions.length,
    income,
    expense,
    savings: income - expense,
    totalGst,
    categoryTotals,
    transactions
  };
};

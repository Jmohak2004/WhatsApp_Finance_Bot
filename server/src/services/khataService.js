import { KhataEntry } from "../models/KhataEntry.js";

const NAME_STOPWORDS = new Set([
  "fuel",
  "petrol",
  "diesel",
  "grocery",
  "groceries",
  "food",
  "rent",
  "electricity",
  "internet",
  "utility",
  "travel",
  "bill",
  "invoice",
  "gst"
]);

const moneyRegex = /([0-9][0-9,]*(?:\.[0-9]{1,2})?)/;

const parseAmount = (raw) => {
  const value = Number(String(raw || "").replace(/,/g, ""));
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
};

const cleanPersonName = (raw) => {
  if (!raw) return "";

  let name = String(raw)
    .split(/\b(for|on|via|using|at|towards|because|since)\b/i)[0]
    .replace(/[^a-zA-Z0-9 .'-]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!name) return "";

  const words = name.split(" ").filter(Boolean);
  if (!words.length || words.length > 5) return "";

  const normalized = words.join(" ");
  const lower = normalized.toLowerCase();

  if (NAME_STOPWORDS.has(lower)) return "";
  if (/^[0-9]+$/.test(lower)) return "";

  return normalized;
};

const isLikelyKhataIntent = (text) => {
  const t = String(text || "").toLowerCase();
  return /\b(sent|gave|lent|loaned|borrowed|took|received|owe|owes|udhar|udharr|udhaar|khata|paid\s*back|returned|settled)\b/.test(
    t
  );
};

export const parseKhataMessage = (text) => {
  const input = String(text || "").trim();
  if (!input || !isLikelyKhataIntent(input)) return null;

  const settlementPatterns = [
    {
      direction: "lent",
      regex:
        /\b([a-z][a-z .'-]{1,60})\s+(?:paid(?:\s+back)?|returned|settled)\s*(?:me\s*)?(?:rs\.?|inr|rupees|\u20B9)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\b/i,
      amountGroup: 2,
      personGroup: 1
    },
    {
      direction: "lent",
      regex:
        /\b(?:received|got)\s*(?:rs\.?|inr|rupees|\u20B9)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:from)\s+([a-z][a-z .'-]{1,60})\s*(?:as\s+)?(?:return|payback|repayment)?\b/i,
      amountGroup: 1,
      personGroup: 2
    },
    {
      direction: "borrowed",
      regex:
        /\b(?:i\s*)?(?:paid(?:\s+back)?|returned|settled)\s*(?:rs\.?|inr|rupees|\u20B9)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:to)\s+([a-z][a-z .'-]{1,60})\b/i,
      amountGroup: 1,
      personGroup: 2
    }
  ];

  for (const pattern of settlementPatterns) {
    const match = input.match(pattern.regex);
    if (!match) continue;

    const amount = parseAmount(match[pattern.amountGroup]);
    const counterpartyName = cleanPersonName(match[pattern.personGroup]);

    if (!amount || !counterpartyName) continue;

    return {
      direction: pattern.direction,
      entryType: "settlement",
      amount,
      counterpartyName,
      note: input
    };
  }

  const patterns = [
    {
      direction: "lent",
      regex:
        /\b(?:i\s*)?(?:sent|gave|lent|loaned|paid)\s*(?:rs\.?|inr|rupees|\u20B9)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:to)\s+([a-z][a-z .'-]{1,60})\b/i,
      amountGroup: 1,
      personGroup: 2
    },
    {
      direction: "borrowed",
      regex:
        /\b(?:i\s*)?(?:borrowed|took|received)\s*(?:rs\.?|inr|rupees|\u20B9)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:from)\s+([a-z][a-z .'-]{1,60})\b/i,
      amountGroup: 1,
      personGroup: 2
    },
    {
      direction: "lent",
      regex:
        /\b([a-z][a-z .'-]{1,60})\s+(?:owes\s+me)\s*(?:rs\.?|inr|rupees|\u20B9)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\b/i,
      amountGroup: 2,
      personGroup: 1
    },
    {
      direction: "borrowed",
      regex:
        /\b(?:i\s*owe)\s+([a-z][a-z .'-]{1,60})\s*(?:rs\.?|inr|rupees|\u20B9)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\b/i,
      amountGroup: 2,
      personGroup: 1
    }
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern.regex);
    if (!match) continue;

    const amount = parseAmount(match[pattern.amountGroup]);
    const counterpartyName = cleanPersonName(match[pattern.personGroup]);

    if (!amount || !counterpartyName) continue;

    return {
      direction: pattern.direction,
      entryType: "debt",
      amount,
      counterpartyName,
      note: input
    };
  }

  const lower = input.toLowerCase();
  if (/(udhar|udharr|udhaar)/.test(lower) && /\bto\b|\bfrom\b/.test(lower)) {
    const amountMatch = input.match(moneyRegex);
    if (amountMatch) {
      const amount = parseAmount(amountMatch[1]);
      const toMatch = input.match(/\bto\s+([a-z][a-z .'-]{1,60})/i);
      const fromMatch = input.match(/\bfrom\s+([a-z][a-z .'-]{1,60})/i);
      const direction = toMatch ? "lent" : fromMatch ? "borrowed" : "";
      const nameRaw = toMatch?.[1] || fromMatch?.[1] || "";
      const counterpartyName = cleanPersonName(nameRaw);

      if (amount && direction && counterpartyName) {
        return {
          direction,
          entryType: "debt",
          amount,
          counterpartyName,
          note: input
        };
      }
    }
  }

  return null;
};

export const createKhataEntry = async ({
  userPhone,
  parsed,
  source = "text",
  rawInput = "",
  documentId = null,
  entryDate = new Date()
}) => {
  if (!userPhone || !parsed?.amount || !parsed?.counterpartyName || !parsed?.direction) {
    throw new Error("Invalid khata entry payload");
  }

  return KhataEntry.create({
    userPhone,
    counterpartyName: parsed.counterpartyName,
    direction: parsed.direction,
    entryType: parsed.entryType || "debt",
    amount: Number(parsed.amount),
    note: parsed.note || "",
    source,
    entryDate,
    rawInput,
    documentId
  });
};

export const createKhataEntryFromText = async ({ userPhone, text, source = "text" }) => {
  const parsed = parseKhataMessage(text);
  if (!parsed) {
    throw new Error("Could not parse khata entry from text");
  }

  const entry = await createKhataEntry({
    userPhone,
    parsed,
    source,
    rawInput: text
  });

  return { entry, parsed };
};

export const getKhataEntries = async ({ userPhone, limit = 200 }) => {
  const cappedLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  return KhataEntry.find({ userPhone }).sort({ entryDate: -1, createdAt: -1 }).limit(cappedLimit);
};

export const getKhataSummary = async ({ userPhone }) => {
  const entries = await KhataEntry.find({ userPhone }).sort({ entryDate: -1, createdAt: -1 }).limit(1000);

  let totalLent = 0;
  let totalBorrowed = 0;
  let totalLentSettled = 0;
  let totalBorrowedSettled = 0;
  const personMap = new Map();

  for (const entry of entries) {
    const entryType = entry.entryType || "debt";
    const isSettlement = entryType === "settlement";

    if (entry.direction === "lent") {
      if (isSettlement) {
        totalLentSettled += entry.amount;
      } else {
        totalLent += entry.amount;
      }
    } else if (isSettlement) {
      totalBorrowedSettled += entry.amount;
    } else {
      totalBorrowed += entry.amount;
    }

    const existing = personMap.get(entry.counterpartyName) || {
      counterpartyName: entry.counterpartyName,
      lent: 0,
      borrowed: 0,
      lentSettled: 0,
      borrowedSettled: 0,
      balance: 0,
      lastEntryAt: entry.entryDate
    };

    if (entry.direction === "lent") {
      if (isSettlement) {
        existing.lentSettled += entry.amount;
      } else {
        existing.lent += entry.amount;
      }
    } else if (isSettlement) {
      existing.borrowedSettled += entry.amount;
    } else {
      existing.borrowed += entry.amount;
    }

    existing.balance = Number(
      (existing.lent - existing.lentSettled - (existing.borrowed - existing.borrowedSettled)).toFixed(2)
    );
    existing.lastEntryAt = existing.lastEntryAt > entry.entryDate ? existing.lastEntryAt : entry.entryDate;

    personMap.set(entry.counterpartyName, existing);
  }

  const byPerson = Array.from(personMap.values()).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

  return {
    totalEntries: entries.length,
    totalLent: Number(totalLent.toFixed(2)),
    totalBorrowed: Number(totalBorrowed.toFixed(2)),
    totalLentSettled: Number(totalLentSettled.toFixed(2)),
    totalBorrowedSettled: Number(totalBorrowedSettled.toFixed(2)),
    netReceivable: Number((totalLent - totalLentSettled - (totalBorrowed - totalBorrowedSettled)).toFixed(2)),
    byPerson,
    recentEntries: entries.slice(0, 20)
  };
};

export const formatKhataSavedMessage = (parsed) => {
  if (parsed.entryType === "settlement") {
    if (parsed.direction === "lent") {
      return `Khata settlement saved: ${parsed.counterpartyName} paid you INR ${parsed.amount.toFixed(2)}.`;
    }

    return `Khata settlement saved: You paid ${parsed.counterpartyName} INR ${parsed.amount.toFixed(2)}.`;
  }

  if (parsed.direction === "lent") {
    return `Khata saved: ${parsed.counterpartyName} owes you INR ${parsed.amount.toFixed(2)}.`;
  }

  return `Khata saved: You owe ${parsed.counterpartyName} INR ${parsed.amount.toFixed(2)}.`;
};

export const formatKhataSummaryMessage = (summary) => {
  if (!summary.totalEntries) {
    return "Khata is empty. Example: 'I sent 500 to Rahul'.";
  }

  const lines = [
    `Khata Summary`,
    `Lent: INR ${summary.totalLent.toFixed(2)}`,
    `Lent Settled: INR ${summary.totalLentSettled.toFixed(2)}`,
    `Borrowed: INR ${summary.totalBorrowed.toFixed(2)}`,
    `Borrowed Settled: INR ${summary.totalBorrowedSettled.toFixed(2)}`,
    `Net: INR ${summary.netReceivable.toFixed(2)}`
  ];

  const topPeople = summary.byPerson.slice(0, 5);
  for (const person of topPeople) {
    if (person.balance > 0) {
      lines.push(`${person.counterpartyName}: owes you INR ${person.balance.toFixed(2)}`);
    } else if (person.balance < 0) {
      lines.push(`${person.counterpartyName}: you owe INR ${Math.abs(person.balance).toFixed(2)}`);
    } else {
      lines.push(`${person.counterpartyName}: settled`);
    }
  }

  return lines.join("\n");
};

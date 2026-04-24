import { InventoryItem } from "../models/InventoryItem.js";
import { InventoryMovement } from "../models/InventoryMovement.js";
import { sendWhatsAppTextMessage } from "./twilioService.js";

const inventorySummaryRegex = /\b(inventory|stock)\s*(summary|report|status)?\b/i;
const lowStockRegex = /\b(low\s*stock|stock\s*alert|inventory\s*alert|inventory\s*low)\b/i;

export const normalizeInventoryItemKey = (name) => {
  const raw = String(name || "")
    .toLowerCase()
    .replace(/\b(pcs|pieces|units|unit|in\s+stock|in\s+inventory|inventory|stock|item|items)\b/g, " ")
    .replace(/[^a-z0-9 -]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!raw) return "";

  const words = raw.split(" ").filter(Boolean);
  if (!words.length || words.length > 5) return "";

  const singularized = words
    .map((word) => {
      if (word.length > 3 && word.endsWith("s")) {
        return word.slice(0, -1);
      }
      return word;
    })
    .join(" ")
    .trim();

  if (!singularized || /^to\b|^from\b/.test(singularized)) {
    return "";
  }

  return singularized;
};

const formatDisplayName = (itemKey) =>
  itemKey
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const parseQuantity = (raw) => {
  const value = Number(String(raw || "").replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? Number(value.toFixed(2)) : 0;
};

const parseNonNegativeNumber = (raw) => {
  const value = Number(String(raw || "").replace(/,/g, ""));
  return Number.isFinite(value) && value >= 0 ? Number(value.toFixed(2)) : -1;
};

const getDateKey = (date = new Date()) => {
  return date.toISOString().slice(0, 10);
};

export const parseInventoryMessage = (text) => {
  const input = String(text || "").trim();
  if (!input) return null;

  const thresholdPatterns = [
    /\b(?:set\s+)?threshold\s+(?:for\s+)?([a-z][a-z0-9 -]{1,60})\s*(?:to|=)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\b/i,
    /\b(?:set\s+)?([a-z][a-z0-9 -]{1,60})\s+threshold\s*(?:to|=)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\b/i,
    /\bthreshold\s+([a-z][a-z0-9 -]{1,60})\s+([0-9][0-9,]*(?:\.[0-9]{1,2})?)\b/i
  ];

  for (const regex of thresholdPatterns) {
    const match = input.match(regex);
    if (!match) continue;

    const itemKey = normalizeInventoryItemKey(match[1]);
    const threshold = parseNonNegativeNumber(match[2]);

    if (!itemKey || threshold < 0) continue;

    return {
      action: "set-threshold",
      itemKey,
      itemName: formatDisplayName(itemKey),
      threshold,
      note: input
    };
  }

  if (lowStockRegex.test(input)) {
    return { action: "low-stock" };
  }

  if (inventorySummaryRegex.test(input) && !/\d/.test(input)) {
    if (/^inventory\s+[a-z]/i.test(input) && !/summary|report|status/i.test(input)) {
      const itemMatch = input.match(/^inventory\s+(.+)$/i);
      const itemKey = normalizeInventoryItemKey(itemMatch?.[1] || "");
      if (itemKey) {
        return { action: "item-summary", itemKey };
      }
    }

    return { action: "summary" };
  }

  const quantityNamePatterns = [
    {
      movementType: "add",
      regex:
        /\b(?:add|added|produce|produced|manufacture|manufactured|receive|received|stocked|restocked)\s+([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:pcs?|pieces?|units?)?\s*(?:of\s+)?((?!to\b|from\b)[a-z][a-z0-9 -]{1,60})\b/i
    },
    {
      movementType: "remove",
      regex:
        /\b(?:sent|sold|dispatched|dispatch|delivered|used|removed|shipped)\s+([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:pcs?|pieces?|units?)?\s*(?:of\s+)?((?!to\b|from\b)[a-z][a-z0-9 -]{1,60})\b/i
    },
    {
      movementType: "set",
      regex:
        /\b(?:i\s+have|have|set|update)\s+([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:pcs?|pieces?|units?)?\s*(?:of\s+)?((?!to\b|from\b)[a-z][a-z0-9 -]{1,60})\s*(?:in\s+inventory|in\s+stock)?\b/i
    },
    {
      movementType: "set",
      regex:
        /\b(?:inventory|stock)\s+((?!summary\b|report\b|status\b|low\b)[a-z][a-z0-9 -]{1,60})\s*(?:to|=)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\b/i,
      reverseGroups: true
    }
  ];

  for (const pattern of quantityNamePatterns) {
    const match = input.match(pattern.regex);
    if (!match) continue;

    const quantityRaw = pattern.reverseGroups ? match[2] : match[1];
    const itemRaw = pattern.reverseGroups ? match[1] : match[2];

    const quantity = parseQuantity(quantityRaw);
    const itemKey = normalizeInventoryItemKey(itemRaw);

    if (!quantity || !itemKey) continue;

    return {
      action: "update",
      movementType: pattern.movementType,
      quantity,
      itemKey,
      itemName: formatDisplayName(itemKey),
      note: input
    };
  }

  const itemSummaryMatch = input.match(
    /\b(?:how\s+many|qty\s+of|quantity\s+of|stock\s+of|inventory\s+of|number\s+of|no\.?\s*of)\s+([a-z][a-z0-9 -]{1,60})\b/i
  );
  if (itemSummaryMatch) {
    const itemKey = normalizeInventoryItemKey(itemSummaryMatch[1]);
    if (itemKey) {
      return { action: "item-summary", itemKey };
    }
  }

  return null;
};

export const applyInventoryUpdate = async ({ userPhone, parsed, source = "text", rawInput = "" }) => {
  if (!userPhone || !parsed?.itemKey || !parsed?.quantity || !parsed?.movementType) {
    throw new Error("Invalid inventory update payload");
  }

  let item = await InventoryItem.findOne({ userPhone, itemKey: parsed.itemKey });
  if (!item) {
    item = await InventoryItem.create({
      userPhone,
      itemKey: parsed.itemKey,
      itemName: parsed.itemName || formatDisplayName(parsed.itemKey),
      quantity: 0,
      lowStockThreshold: 100,
      unit: "pcs"
    });
  }

  const previousQuantity = Number(item.quantity || 0);
  let newQuantity = previousQuantity;

  if (parsed.movementType === "add") {
    newQuantity = previousQuantity + parsed.quantity;
  } else if (parsed.movementType === "remove") {
    newQuantity = Math.max(previousQuantity - parsed.quantity, 0);
  } else {
    newQuantity = Math.max(parsed.quantity, 0);
  }

  item.quantity = Number(newQuantity.toFixed(2));
  item.itemName = parsed.itemName || item.itemName;
  item.lastUpdatedAt = new Date();
  await item.save();

  const quantityChange = Number((item.quantity - previousQuantity).toFixed(2));

  const movement = await InventoryMovement.create({
    userPhone,
    itemKey: item.itemKey,
    itemName: item.itemName,
    movementType: parsed.movementType,
    quantityChange,
    quantityAfter: item.quantity,
    note: parsed.note || "",
    source,
    rawInput
  });

  const crossedLowThreshold = previousQuantity >= item.lowStockThreshold && item.quantity < item.lowStockThreshold;
  const isLow = item.quantity < item.lowStockThreshold;

  return {
    parsed,
    item,
    movement,
    crossedLowThreshold,
    isLow,
    previousQuantity
  };
};

export const setInventoryThreshold = async ({ userPhone, parsed, source = "text", rawInput = "" }) => {
  if (!userPhone || !parsed?.itemKey || parsed?.threshold === undefined) {
    throw new Error("Invalid inventory threshold payload");
  }

  let item = await InventoryItem.findOne({ userPhone, itemKey: parsed.itemKey });
  if (!item) {
    item = await InventoryItem.create({
      userPhone,
      itemKey: parsed.itemKey,
      itemName: parsed.itemName || formatDisplayName(parsed.itemKey),
      quantity: 0,
      lowStockThreshold: Number(parsed.threshold),
      unit: "pcs"
    });
  }

  const previousThreshold = Number(item.lowStockThreshold || 0);
  item.lowStockThreshold = Number(parsed.threshold);
  item.itemName = parsed.itemName || item.itemName;
  item.lastUpdatedAt = new Date();
  await item.save();

  await InventoryMovement.create({
    userPhone,
    itemKey: item.itemKey,
    itemName: item.itemName,
    movementType: "set",
    quantityChange: 0,
    quantityAfter: item.quantity,
    note: parsed.note || "",
    source,
    rawInput
  });

  return {
    parsed,
    item,
    previousThreshold,
    isLow: item.quantity < item.lowStockThreshold
  };
};

export const getInventorySummary = async ({ userPhone }) => {
  const items = await InventoryItem.find({ userPhone }).sort({ quantity: 1, itemName: 1 });

  const lowStockItems = items.filter((item) => item.quantity < item.lowStockThreshold);
  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    totalItems: items.length,
    totalUnits: Number(totalUnits.toFixed(2)),
    lowStockCount: lowStockItems.length,
    lowStockItems,
    items
  };
};

export const getInventoryItem = async ({ userPhone, itemKey }) => {
  return InventoryItem.findOne({ userPhone, itemKey });
};

export const formatInventorySavedMessage = ({ item, parsed, isLow }) => {
  const actionWord =
    parsed.movementType === "add"
      ? "added"
      : parsed.movementType === "remove"
        ? "removed"
        : "set";

  const base = `Inventory updated: ${parsed.quantity} ${item.unit} ${actionWord} for ${item.itemName}. Current stock: ${item.quantity} ${item.unit}.`;

  if (isLow) {
    return `${base}\nAlert: ${item.itemName} is below threshold (${item.lowStockThreshold}).`;
  }

  return base;
};

export const formatInventorySummaryMessage = (summary) => {
  if (!summary.totalItems) {
    return "Inventory is empty. Example: 'add 250 soaps'.";
  }

  const lines = [
    `Inventory Summary`,
    `Items: ${summary.totalItems}`,
    `Total Units: ${summary.totalUnits.toFixed(2)}`,
    `Low Stock Items: ${summary.lowStockCount}`
  ];

  for (const item of summary.items.slice(0, 8)) {
    const suffix = item.quantity < item.lowStockThreshold ? " (LOW)" : "";
    lines.push(`${item.itemName}: ${item.quantity} ${item.unit}${suffix}`);
  }

  return lines.join("\n");
};

export const formatInventoryItemMessage = (item) => {
  if (!item) {
    return "Item not found in inventory.";
  }

  const low = item.quantity < item.lowStockThreshold ? "LOW STOCK" : "OK";
  return `${item.itemName}: ${item.quantity} ${item.unit} | Threshold: ${item.lowStockThreshold} | ${low}`;
};

export const formatInventoryThresholdMessage = ({ item, previousThreshold, isLow }) => {
  const message = `Threshold updated: ${item.itemName} threshold changed from ${previousThreshold} to ${item.lowStockThreshold}. Current stock: ${item.quantity} ${item.unit}.`;

  if (isLow) {
    return `${message}\nAlert: ${item.itemName} is currently below threshold.`;
  }

  return message;
};

export const sendLowStockNotification = async ({ userPhone, item }) => {
  if (!userPhone || !item) return;

  const message = `Low stock alert: ${item.itemName} is at ${item.quantity} ${item.unit}, below threshold ${item.lowStockThreshold}.`;

  try {
    await sendWhatsAppTextMessage({ to: userPhone, body: message });
    item.lastLowStockAlertSentAt = new Date();
    await item.save();
  } catch (error) {
    console.warn("Low stock notification failed", error.message);
  }
};

export const sendDailyLowStockReminders = async () => {
  const todayKey = getDateKey();
  const items = await InventoryItem.find({ alertEnabled: true }).sort({ userPhone: 1, itemName: 1 });
  const byUser = new Map();

  for (const item of items) {
    const isLow = item.quantity < item.lowStockThreshold;
    if (!isLow) continue;
    if (item.lastDailyReminderDate === todayKey) continue;

    const list = byUser.get(item.userPhone) || [];
    list.push(item);
    byUser.set(item.userPhone, list);
  }

  let remindersSent = 0;

  for (const [userPhone, lowItems] of byUser.entries()) {
    const lines = ["Daily low stock reminder:"];
    for (const item of lowItems.slice(0, 12)) {
      lines.push(`- ${item.itemName}: ${item.quantity} ${item.unit} (threshold ${item.lowStockThreshold})`);
    }
    if (lowItems.length > 12) {
      lines.push(`- and ${lowItems.length - 12} more item(s)`);
    }

    try {
      await sendWhatsAppTextMessage({ to: userPhone, body: lines.join("\n") });

      const now = new Date();
      const ids = lowItems.map((item) => item._id);
      await InventoryItem.updateMany(
        { _id: { $in: ids } },
        {
          $set: {
            lastDailyReminderDate: todayKey,
            lastLowStockAlertSentAt: now
          }
        }
      );

      remindersSent += 1;
    } catch (error) {
      console.warn(`Daily low stock reminder failed for ${userPhone}`, error.message);
    }
  }

  return {
    usersWithReminders: byUser.size,
    remindersSent
  };
};

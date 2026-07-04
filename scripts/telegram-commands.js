import fs from "node:fs/promises";

const LATEST_PATH = "data/latest.json";
const OFFSET_PATH = "data/telegram-offset.json";

async function readJson(path, fallback) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(path, data) {
  await fs.writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function formatMoney(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "暫未能讀取";
  return `SGD ${value.toFixed(2)} / gram`;
}

function brandLine(item) {
  if (!item) return "";
  if (item.status !== "ok") return `${item.brand}\n暫未能讀取`;
  return `${item.brand}\n${formatMoney(Number(item.price))}`;
}

function buildPriceMessage(latest) {
  const items = latest.items || [];
  const poh = items.find((item) => item.id === "poh-heng-24k-999");
  const ctf = items.find((item) => item.id === "chow-tai-fook-sg-24k-999");
  const lukfook = items.find((item) => item.id === "lukfook-sg-formula-24k-999");

  return [
    "Singapore Gold Price",
    "",
    brandLine(poh),
    "",
    brandLine(ctf),
    "",
    brandLine(lukfook),
    "",
    `Last update: ${latest.updatedAt || "未更新"}`
  ].join("\n");
}

function buildHelpMessage() {
  return [
    "可用指令：",
    "/price - 查詢最新金價",
    "/status - 查詢監察狀態",
    "/help - 顯示指令"
  ].join("\n");
}

function buildStatusMessage(latest) {
  const items = latest.items || [];
  const lines = items.map((item) => `${item.brand}: ${item.status === "ok" ? "正常" : "暫未能讀取"}`);
  return ["Gold Monitor Status", "", ...lines, "", `Last update: ${latest.updatedAt || "未更新"}`].join("\n");
}

async function telegramRequest(token, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, description: text };
  }
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const allowedChatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !allowedChatId) {
    console.log("Telegram secrets are not set. Skipping command check.");
    return;
  }

  const state = await readJson(OFFSET_PATH, { offset: 0 });
  const latest = await readJson(LATEST_PATH, { items: [] });

  const updates = await telegramRequest(token, "getUpdates", {
    offset: Number(state.offset || 0),
    timeout: 0,
    allowed_updates: ["message"]
  });

  if (!updates.ok) {
    console.log("getUpdates failed", updates.description || updates);
    return;
  }

  let nextOffset = Number(state.offset || 0);

  for (const update of updates.result || []) {
    nextOffset = Math.max(nextOffset, Number(update.update_id) + 1);
    const message = update.message;
    if (!message || !message.chat || !message.text) continue;

    const chatId = String(message.chat.id);
    if (chatId !== String(allowedChatId)) continue;

    const text = String(message.text).trim().split(" ")[0].toLowerCase();
    let reply = null;

    if (text === "/price" || text === "/price@sg_gold_price_alert_bot") {
      reply = buildPriceMessage(latest);
    } else if (text === "/status" || text === "/status@sg_gold_price_alert_bot") {
      reply = buildStatusMessage(latest);
    } else if (text === "/help" || text === "/start") {
      reply = buildHelpMessage();
    }

    if (reply) {
      await telegramRequest(token, "sendMessage", {
        chat_id: chatId,
        text: reply,
        disable_web_page_preview: true
      });
    }
  }

  await writeJson(OFFSET_PATH, { offset: nextOffset });
  console.log(`Telegram command check complete. Next offset: ${nextOffset}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import fs from "node:fs/promises";

const LATEST_PATH = "data/latest.json";
const OFFSET_PATH = "data/telegram-offset.json";
const BOT_USERNAME = "sg_gold_price_alert_bot";

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

function formatSgtTime(value) {
  if (!value) return "未更新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未更新";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.day} ${parts.month} ${parts.year}\n${parts.hour}:${parts.minute}:${parts.second} (SGT)`;
}

function formatMoney(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "暫未能讀取";
  return `SGD ${value.toFixed(2)} / 克`;
}

function displayName(item) {
  if (!item) return "";
  if (item.id === "poh-heng-24k-999") return "🟡 Poh Heng";
  if (item.id === "chow-tai-fook-sg-24k-999") return "🟠 Chow Tai Fook";
  if (item.id === "lukfook-sg-formula-24k-999") return "💎 六福珠寶";
  return item.brand;
}

function brandLine(item) {
  if (!item) return "";
  if (item.status !== "ok") return `${displayName(item)}\n⚠️ 暫未能讀取`;
  return `${displayName(item)}\n💰 ${formatMoney(Number(item.price))}`;
}

function buildPriceMessage(latest) {
  const items = latest.items || [];
  const poh = items.find((item) => item.id === "poh-heng-24k-999");
  const ctf = items.find((item) => item.id === "chow-tai-fook-sg-24k-999");
  const lukfook = items.find((item) => item.id === "lukfook-sg-formula-24k-999");

  return [
    "🇸🇬 新加坡 24K / 999 金價",
    "",
    brandLine(poh),
    "",
    brandLine(ctf),
    "",
    brandLine(lukfook),
    "",
    "━━━━━━━━━━━━━━━━",
    "",
    "🕒 最後更新",
    formatSgtTime(latest.updatedAt),
    "",
    "🤖 每小時自動更新"
  ].join("\n");
}

function buildHelpMessage() {
  return [
    "🤖 Singapore Gold Monitor",
    "",
    "可用指令：",
    "",
    "💰 /price",
    "查詢最新金價",
    "",
    "⚙️ /status",
    "查看監察狀態",
    "",
    "❓ /help",
    "顯示說明"
  ].join("\n");
}

function buildStatusMessage(latest) {
  const items = latest.items || [];
  const lines = items.map((item) => `${item.status === "ok" ? "🟢" : "🟡"} ${displayName(item).replace(/^[^\w\u4e00-\u9fff]+\s*/, "")}\n${item.status === "ok" ? "正常" : "暫未能讀取"}`);
  return [
    "⚙️ 金價監察狀態",
    "",
    ...lines,
    "",
    "🕒 最後檢查",
    formatSgtTime(latest.updatedAt)
  ].join("\n");
}

function telegramUrl(token, method) {
  return "https://api.tele" + "gram.org/bot" + token + "/" + method;
}

async function telegramRequest(token, method, payload) {
  const response = await fetch(telegramUrl(token, method), {
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

function normalizeCommand(text) {
  return String(text || "").trim().split(/\s+/)[0].toLowerCase().replace(`@${BOT_USERNAME}`, "");
}

async function main() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const allowedChatId = String(process.env.TELEGRAM_CHAT_ID || "").trim();
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

  console.log(`Telegram updates received: ${(updates.result || []).length}`);

  let nextOffset = Number(state.offset || 0);
  let repliesSent = 0;

  for (const update of updates.result || []) {
    nextOffset = Math.max(nextOffset, Number(update.update_id) + 1);
    const message = update.message;
    if (!message || !message.chat || !message.text) continue;

    const chatId = String(message.chat.id).trim();
    const command = normalizeCommand(message.text);
    console.log(`Telegram message: chat=${chatId}, command=${command}`);

    if (chatId !== allowedChatId) {
      console.log(`Skipped chat ${chatId}; allowed chat is ${allowedChatId}`);
      continue;
    }

    let reply = null;
    if (command === "/price") reply = buildPriceMessage(latest);
    if (command === "/status") reply = buildStatusMessage(latest);
    if (command === "/help" || command === "/start") reply = buildHelpMessage();

    if (reply) {
      const result = await telegramRequest(token, "sendMessage", {
        chat_id: chatId,
        text: reply,
        disable_web_page_preview: true
      });
      console.log(`Reply result: ${result.ok ? "ok" : result.description || "failed"}`);
      repliesSent += 1;
    }
  }

  await writeJson(OFFSET_PATH, { offset: nextOffset });
  console.log(`Telegram command check complete. Replies sent: ${repliesSent}. Next offset: ${nextOffset}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

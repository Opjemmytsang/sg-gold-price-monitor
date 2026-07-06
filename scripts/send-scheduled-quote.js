import fs from "node:fs/promises";

const LATEST_PATH = "data/latest.json";
const NOTIFY_HOURS_SGT = new Set([0, 8, 10]);

async function readJson(path, fallback) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function getSgtHour(value) {
  const date = new Date(value || Date.now());
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    hour: "2-digit",
    hour12: false
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value;
  return Number(hour);
}

function formatSgtTime(value) {
  if (!value) return "Not updated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not updated";
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

function money(item) {
  if (!item || item.status !== "ok" || typeof item.price !== "number") return "Unavailable";
  return `SGD ${item.price.toFixed(2)} / gram`;
}

function find(items, id) {
  return items.find((item) => item.id === id);
}

function buildMessage(latest) {
  const items = latest.items || [];
  const poh = find(items, "poh-heng-24k-999");
  const ctf = find(items, "chow-tai-fook-sg-24k-999");
  const lukfook = find(items, "lukfook-sg-formula-24k-999");

  return [
    "🇸🇬 Singapore Gold Monitor",
    "",
    "🟡 Poh Heng",
    `💰 ${money(poh)}`,
    "",
    "🟠 Chow Tai Fook",
    `💰 ${money(ctf)}`,
    "",
    "💎 Luk Fook Jewellery",
    `💰 ${money(lukfook)}`,
    "",
    "━━━━━━━━━━━━━━━━",
    "",
    "🕒 Last Updated",
    formatSgtTime(latest.updatedAt),
    "",
    "🤖 Scheduled Quote"
  ].join("\n");
}

function telegramUrl(token, method) {
  return "https://api.tele" + "gram.org/bot" + token + "/" + method;
}

async function sendTelegram(message) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatId) {
    console.log("Telegram secrets are not set. Scheduled quote skipped.");
    return;
  }

  const response = await fetch(telegramUrl(token, "sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true
    })
  });

  const text = await response.text();
  if (!response.ok) {
    console.log("Scheduled quote failed:", response.status, text);
    return;
  }
  console.log("Scheduled quote sent.");
}

async function main() {
  const latest = await readJson(LATEST_PATH, { items: [] });
  const forceQuote = String(process.env.SEND_QUOTE_ALWAYS || "").toLowerCase() === "true";
  const sgtHour = getSgtHour(latest.updatedAt || Date.now());

  if (!forceQuote && !NOTIFY_HOURS_SGT.has(sgtHour)) {
    console.log(`Scheduled quote skipped. Current SGT hour: ${sgtHour}. Notify hours: 00, 08, 10.`);
    return;
  }

  await sendTelegram(buildMessage(latest));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

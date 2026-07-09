import fs from "node:fs/promises";

const DATA_PATH = "data/latest.json";
const HISTORY_PATH = "data/history.json";
const LUKFOOK_ID = "lukfook-sg-formula-24k-999";
const POH_HENG_ID = "poh-heng-24k-999";
const CTF_ID = "chow-tai-fook-sg-24k-999";

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function isValidPrice(item) {
  return item?.status === "ok" && Number.isFinite(Number(item.price));
}

function formatSgtTime(value) {
  const date = new Date(value || Date.now());
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

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const base = "https://api.telegram.org/";
  const path = `bot${token}/sendMessage`;
  await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true
    })
  });
}

function buildLukFookItem(latest) {
  const items = latest.items || [];
  const poh = items.find((item) => item.id === POH_HENG_ID);
  const ctf = items.find((item) => item.id === CTF_ID);
  const checkedAt = latest.updatedAt || new Date().toISOString();
  const filteredItems = items.filter((item) => item.id !== LUKFOOK_ID);

  if (!isValidPrice(poh)) {
    return {
      latest: {
        ...latest,
        items: [
          ...filteredItems,
          {
            id: LUKFOOK_ID,
            brand: "六福珠寶",
            label: "24K / 999",
            url: "#",
            status: "error",
            error: "Poh Heng 金價讀取失敗，未能計算六福建議金價。",
            checkedAt
          }
        ]
      },
      alert: null
    };
  }

  const pohFormula = round2(Number(poh.price) + 2);
  const formulaItem = {
    id: LUKFOOK_ID,
    brand: "六福珠寶",
    label: "24K / 999",
    url: "#",
    status: "ok",
    price: pohFormula,
    currency: "SGD",
    unit: "gram",
    rawText: "Poh Heng 24K / 999 + SGD 2.00",
    basis: {
      source: "Poh Heng",
      sourcePrice: Number(poh.price),
      adjustment: 2
    },
    checkedAt
  };

  if (!isValidPrice(ctf)) {
    return {
      latest: {
        ...latest,
        items: [...filteredItems, { ...formulaItem, note: "Chow Tai Fook 暫時未能讀取，只以 Poh Heng + SGD 2 計算。" }]
      },
      alert: null
    };
  }

  const ctfFormula = round2(Number(ctf.price) - 3);
  const diff = round2(pohFormula - ctfFormula);

  if (Math.abs(diff) > 0.009) {
    return {
      latest: {
        ...latest,
        items: [...filteredItems, formulaItem]
      },
      alert: [
        "⚠️ 新加坡金價對照差異",
        "",
        "六福建議金價已按 Poh Heng + 2 正常計算：",
        `➡️ SGD ${pohFormula.toFixed(2)} / 克`,
        "",
        "🟡 Poh Heng + 2",
        `➡️ SGD ${pohFormula.toFixed(2)} / 克`,
        "",
        "🟠 Chow Tai Fook - 3",
        `➡️ SGD ${ctfFormula.toFixed(2)} / 克`,
        "",
        "相差",
        `SGD ${Math.abs(diff).toFixed(2)} / 克`,
        "",
        "請人工覆核對照價格。",
        "",
        "🕒 檢查時間",
        formatSgtTime(checkedAt)
      ].join("\n")
    };
  }

  return {
    latest: {
      ...latest,
      items: [...filteredItems, formulaItem]
    },
    alert: null
  };
}

async function main() {
  const latest = await readJson(DATA_PATH, { items: [] });
  const result = buildLukFookItem(latest);
  await writeJson(DATA_PATH, result.latest);

  const history = await readJson(HISTORY_PATH, []);
  if (history.length) {
    history[history.length - 1] = result.latest;
    await writeJson(HISTORY_PATH, history.slice(-500));
  }

  if (result.alert) await sendTelegram(result.alert);
  console.log(result.latest.items.map((item) => item.status === "ok" ? `${item.brand}: ${item.price}` : `${item.brand}: ${item.error}`).join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

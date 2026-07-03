import fs from "node:fs/promises";

const DATA_PATH = "data/latest.json";
const HISTORY_PATH = "data/history.json";
const LUKFOOK_ID = "lukfook-sg-formula-24k-999";

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
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
  const poh = items.find((item) => item.id === "poh-heng-24k-999");
  const ctf = items.find((item) => item.id === "chow-tai-fook-sg-24k-999");
  const checkedAt = latest.updatedAt || new Date().toISOString();

  const filteredItems = items.filter((item) => item.id !== LUKFOOK_ID);

  if (poh?.status !== "ok" || ctf?.status !== "ok") {
    return {
      latest: {
        ...latest,
        items: [
          ...filteredItems,
          {
            id: LUKFOOK_ID,
            brand: "Luk Fook Jewellery SG",
            label: "24K / 999 Formula Check",
            url: "#",
            status: "error",
            error: "Cannot calculate Luk Fook formula because Poh Heng or Chow Tai Fook price is unavailable.",
            checkedAt
          }
        ]
      },
      alert: null
    };
  }

  const pohFormula = round2(Number(poh.price) + 2);
  const ctfFormula = round2(Number(ctf.price) - 3);
  const diff = round2(pohFormula - ctfFormula);

  if (Math.abs(diff) > 0.009) {
    return {
      latest: {
        ...latest,
        items: [
          ...filteredItems,
          {
            id: LUKFOOK_ID,
            brand: "Luk Fook Jewellery SG",
            label: "24K / 999 Formula Check",
            url: "#",
            status: "error",
            error: `Formula mismatch: Poh Heng + 2 = SGD ${pohFormula.toFixed(2)}, Chow Tai Fook - 3 = SGD ${ctfFormula.toFixed(2)}. Difference = SGD ${diff.toFixed(2)} / gram.`,
            checkedAt
          }
        ]
      },
      alert: [
        "Luk Fook SG price formula mismatch",
        `Poh Heng: SGD ${Number(poh.price).toFixed(2)} + 2 = SGD ${pohFormula.toFixed(2)} / gram`,
        `Chow Tai Fook: SGD ${Number(ctf.price).toFixed(2)} - 3 = SGD ${ctfFormula.toFixed(2)} / gram`,
        `Difference: SGD ${diff.toFixed(2)} / gram`,
        `Checked at: ${checkedAt}`
      ].join("\n")
    };
  }

  return {
    latest: {
      ...latest,
      items: [
        ...filteredItems,
        {
          id: LUKFOOK_ID,
          brand: "Luk Fook Jewellery SG",
          label: "24K / 999 Suggested",
          url: "#",
          status: "ok",
          price: pohFormula,
          currency: "SGD",
          unit: "gram",
          rawText: `Poh Heng + 2 = SGD ${pohFormula.toFixed(2)}; Chow Tai Fook - 3 = SGD ${ctfFormula.toFixed(2)}; matched.`,
          formula: {
            pohHengPlus2: pohFormula,
            chowTaiFookMinus3: ctfFormula,
            difference: diff
          },
          checkedAt
        }
      ]
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

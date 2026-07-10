import fs from "node:fs/promises";

const DATA_PATH = "data/latest.json";
const HISTORY_PATH = "data/history.json";
const LUKFOOK_ID = "lukfook-sg-formula-24k-999";
const CTF_ID = "chow-tai-fook-sg-24k-999";

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function isValidPrice(item) {
  return item?.status === "ok" && Number.isFinite(Number(item.price));
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

function buildLukFookItem(latest) {
  const items = latest.items || [];
  const ctf = items.find((item) => item.id === CTF_ID);
  const checkedAt = latest.updatedAt || new Date().toISOString();
  const filteredItems = items.filter((item) => item.id !== LUKFOOK_ID);

  if (!isValidPrice(ctf)) {
    return {
      ...latest,
      items: [
        ...filteredItems,
        {
          id: LUKFOOK_ID,
          brand: "六福珠寶",
          label: "24K / 999",
          url: "#",
          status: "error",
          error: "Chow Tai Fook SG 金價讀取失敗，未能計算六福建議金價。",
          checkedAt
        }
      ]
    };
  }

  const lukFookPrice = round2(Number(ctf.price) - 3);
  const formulaItem = {
    id: LUKFOOK_ID,
    brand: "六福珠寶",
    label: "24K / 999",
    url: "#",
    status: "ok",
    price: lukFookPrice,
    currency: "SGD",
    unit: "gram",
    rawText: "Chow Tai Fook SG 999.9 Gold Selling Price - SGD 3.00",
    basis: {
      source: "Chow Tai Fook SG",
      sourcePrice: Number(ctf.price),
      adjustment: -3
    },
    checkedAt
  };

  return {
    ...latest,
    items: [...filteredItems, formulaItem]
  };
}

async function main() {
  const latest = await readJson(DATA_PATH, { items: [] });
  const result = buildLukFookItem(latest);
  await writeJson(DATA_PATH, result);

  const history = await readJson(HISTORY_PATH, []);
  if (history.length) {
    history[history.length - 1] = result;
    await writeJson(HISTORY_PATH, history.slice(-500));
  }

  console.log(result.items.map((item) => item.status === "ok" ? `${item.brand}: ${item.price}` : `${item.brand}: ${item.error}`).join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

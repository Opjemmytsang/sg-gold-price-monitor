import fs from "node:fs/promises";

const DATA_PATH = "data/latest.json";
const HISTORY_PATH = "data/history.json";
const LUKFOOK_ID = "lukfook-sg-formula-24k-999";
const POH_HENG_ID = "poh-heng-24k-999";

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
  const pohHeng = items.find((item) => item.id === POH_HENG_ID);
  const checkedAt = latest.updatedAt || new Date().toISOString();
  const filteredItems = items.filter((item) => item.id !== LUKFOOK_ID);

  if (!isValidPrice(pohHeng)) {
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
          error: "Poh Heng 金價讀取失敗，未能更新六福金價。",
          checkedAt
        }
      ]
    };
  }

  const formulaItem = {
    id: LUKFOOK_ID,
    brand: "六福珠寶",
    label: "24K / 999",
    url: "#",
    status: "ok",
    price: Number(pohHeng.price),
    currency: "SGD",
    unit: "gram",
    rawText: "Same as Poh Heng 24K / 999 Gold Price",
    basis: {
      source: "Poh Heng",
      sourcePrice: Number(pohHeng.price),
      adjustment: 0
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

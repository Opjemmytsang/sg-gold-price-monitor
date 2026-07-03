import fs from "node:fs/promises";

const SOURCES = [
  {
    id: "poh-heng-24k-999",
    brand: "Poh Heng",
    label: "24K / 999",
    url: "https://pohheng.com.sg/",
    parser: parsePohHeng24K999
  },
  {
    id: "chow-tai-fook-sg-24k-999",
    brand: "Chow Tai Fook SG",
    label: "24K / 999",
    url: "https://www.chowtaifook.com/sg",
    parser: parseChowTaiFook24K999
  }
];

const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-SG,en;q=0.9,zh-HK;q=0.8,zh;q=0.7"
};

function normalizeText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePohHeng24K999(html) {
  const text = normalizeText(html);
  const match = text.match(/24K\s*\/\s*999\s+at\s+\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*per\s*gram/i);
  if (!match) throw new Error("Cannot find Poh Heng pattern: 24K / 999 at $xxx.xx per gram");
  return {
    price: Number(match[1]),
    currency: "SGD",
    unit: "gram",
    rawText: match[0]
  };
}

function parseChowTaiFook24K999(html) {
  const text = normalizeText(html);
  const patterns = [
    /(?:24K|999)[\s\S]{0,100}?\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:\/|per)?\s*(?:g|gram)/i,
    /\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:\/|per)?\s*(?:g|gram)[\s\S]{0,100}?(?:24K|999)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        price: Number(match[1]),
        currency: "SGD",
        unit: "gram",
        rawText: match[0]
      };
    }
  }
  throw new Error("Cannot find Chow Tai Fook SG 24K / 999 price pattern. Site may be blocked or dynamically rendered.");
}

async function fetchHtml(url) {
  const response = await fetch(url, { headers: HEADERS, redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return await response.text();
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(path, data) {
  await fs.mkdir(path.split("/").slice(0, -1).join("/"), { recursive: true });
  await fs.writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function sendWeCom(message) {
  const webhook = process.env.WECOM_WEBHOOK;
  if (!webhook) {
    console.log("WECOM_WEBHOOK is not set. Skipping WeCom notification.");
    return;
  }

  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      msgtype: "text",
      text: { content: message }
    })
  });

  const resultText = await response.text();
  if (!response.ok) {
    console.log("WeCom notification failed:", response.status, resultText);
    return;
  }

  try {
    const result = JSON.parse(resultText);
    if (result.errcode !== 0) console.log("WeCom returned error:", resultText);
  } catch {
    console.log("WeCom response:", resultText);
  }
}

function formatChangeLine(previous, current) {
  const direction = current.change > 0 ? "↑" : "↓";
  const sign = current.change > 0 ? "+" : "";
  return `${current.brand}\nSGD ${Number(previous.price).toFixed(2)} → SGD ${Number(current.price).toFixed(2)} / gram\n${direction} ${sign}${current.change.toFixed(2)}`;
}

async function main() {
  const previous = await readJson("data/latest.json", { items: [] });
  const previousById = new Map((previous.items || []).map((item) => [item.id, item]));
  const checkedAt = new Date().toISOString();
  const items = [];
  const changes = [];

  for (const source of SOURCES) {
    try {
      const html = await fetchHtml(source.url);
      const parsed = source.parser(html);
      const prev = previousById.get(source.id);
      const item = {
        id: source.id,
        brand: source.brand,
        label: source.label,
        url: source.url,
        status: "ok",
        price: parsed.price,
        currency: parsed.currency,
        unit: parsed.unit,
        rawText: parsed.rawText,
        checkedAt
      };
      if (prev?.status === "ok" && Number(prev.price) !== Number(item.price)) {
        item.previousPrice = Number(prev.price);
        item.change = Number((item.price - prev.price).toFixed(2));
        changes.push({ previous: prev, current: item });
      }
      items.push(item);
    } catch (error) {
      const prev = previousById.get(source.id);
      items.push({
        id: source.id,
        brand: source.brand,
        label: source.label,
        url: source.url,
        status: "error",
        error: error.message,
        previousPrice: prev?.price ?? null,
        checkedAt
      });
    }
  }

  const latest = { updatedAt: checkedAt, timezone: "Asia/Singapore", items };
  const history = await readJson("data/history.json", []);
  history.push(latest);
  await writeJson("data/latest.json", latest);
  await writeJson("data/history.json", history.slice(-500));

  console.log(items.map((i) => i.status === "ok" ? `${i.brand}: SGD ${i.price.toFixed(2)} / gram` : `${i.brand}: ${i.error}`).join("\n"));

  if (changes.length) {
    const message = [
      "🔔 新加坡 24K / 999 金價有變動",
      "",
      ...changes.map(({ previous, current }) => formatChangeLine(previous, current)),
      "",
      `更新時間：${checkedAt}`
    ].join("\n");
    await sendWeCom(message);
  } else {
    console.log("No price changes detected. WeCom notification not sent.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import fs from "node:fs/promises";
import { chromium } from "playwright";

const MIN_VALID_PRICE = 150;
const MAX_VALID_PRICE = 400;

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
    url: "https://www.chowtaifook.com/sg/eshop/jewellery/pure-gold",
    parser: parseChowTaiFook24K999
  }
];

const BROWSER_HEADERS = {
  "accept-language": "en-SG,en;q=0.9,zh-HK;q=0.8,zh;q=0.7",
  "cache-control": "no-cache",
  "pragma": "no-cache"
};

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#36;/g, "$")
    .replace(/&dollar;/g, "$")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function normalizeText(input) {
  return decodeEntities(String(input || ""))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isValidGoldPrice(value) {
  return Number.isFinite(value) && value >= MIN_VALID_PRICE && value <= MAX_VALID_PRICE;
}

function toNumber(priceText) {
  return Number(String(priceText || "").replace(/,/g, ""));
}

function buildResult(matchText, price) {
  const value = Number(price);
  if (!isValidGoldPrice(value)) {
    throw new Error(`Rejected invalid gold price candidate: ${price}`);
  }
  return {
    price: value,
    currency: "SGD",
    unit: "gram",
    rawText: normalizeText(matchText).slice(0, 220)
  };
}

function extractCandidates(text, patterns) {
  const candidates = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[0];
      const priceText = match.groups?.price || match[1] || match[2];
      const price = toNumber(priceText);
      if (isValidGoldPrice(price)) candidates.push({ price, raw });
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
    }
  }
  return candidates;
}

function parsePohHeng24K999(content) {
  const text = normalizeText(content);
  const patterns = [
    /24\s*K\s*\/\s*999(?:\.\d+)?\s*at\s*(?:S\$|SGD|\$)\s*(?<price>[1-3]\d{2}(?:\.\d{1,2})?)\s*\/\s*g/gi,
    /24\s*K\s*\/\s*999(?:\.\d+)?\s*at\s*(?:S\$|SGD|\$)\s*(?<price>[1-3]\d{2}(?:\.\d{1,2})?)\s*\/\s*gram/gi,
    /24\s*K\s*\/\s*999(?:\.\d+)?\s*at\s*(?:S\$|SGD|\$)\s*(?<price>[1-3]\d{2}(?:\.\d{1,2})?)/gi
  ];

  const candidates = extractCandidates(text, patterns);
  if (!candidates.length) {
    throw new Error("Cannot find Poh Heng exact 24K / 999 at SGD price line. Expected format: 24K / 999 at $xxx.xx / g.");
  }
  return buildResult(candidates[0].raw, candidates[0].price);
}

function parseChowTaiFook24K999(content) {
  const text = normalizeText(content);

  const exactSellingPricePatterns = [
    /Today'?s\s+999(?:\.9)?\s+Gold\s+Selling\s+Price\s*(?:S\$|SGD|\$)\s*(?<price>[1-3]\d{2}(?:\.\d{1,2})?)\s*\/\s*gram/gi,
    /999(?:\.9)?\s+Gold\s+Selling\s+Price\s*(?:S\$|SGD|\$)\s*(?<price>[1-3]\d{2}(?:\.\d{1,2})?)\s*\/\s*(?:g|gram)/gi,
    /(?:S\$|SGD|\$)\s*(?<price>[1-3]\d{2}(?:\.\d{1,2})?)\s*\/\s*gram[\s\S]{0,80}?(?:999(?:\.9)?\s+Gold\s+Selling\s+Price|Pure\s+Gold)/gi
  ];
  const exactCandidates = extractCandidates(text, exactSellingPricePatterns);
  if (exactCandidates.length) {
    exactCandidates.sort((a, b) => {
      const score = (candidate) => {
        let value = 0;
        if (/Today'?s/i.test(candidate.raw)) value += 5;
        if (/999\.9|999/i.test(candidate.raw)) value += 5;
        if (/Selling\s+Price/i.test(candidate.raw)) value += 5;
        if (/\/\s*gram/i.test(candidate.raw)) value += 5;
        return value;
      };
      return score(b) - score(a);
    });
    return buildResult(exactCandidates[0].raw, exactCandidates[0].price);
  }

  const qualityClue = /(?:24\s*K|999(?:\.9)?|足金|pure\s*gold|999\s*gold|gold\s*price|gold\s*selling\s*price)/i;
  const unitClue = /(?:per\s*gram|\/\s*g|\/\s*gram|gram|克)/i;
  const rejectClue = /(?:instalment|installment|monthly|from\s*S\$|qty|quantity|items?|cart|shipping|delivery|discount|promo|voucher)/i;
  const patterns = [
    /(?:Today'?s\s+)?(?:24\s*K|999(?:\.9)?|足金|pure\s*gold|999\s*gold|gold\s*price|gold\s*selling\s*price)[\s\S]{0,260}?(?:S\$|SGD|\$)\s*(?<price>[1-3]\d{2}(?:\.\d{1,2})?)[\s\S]{0,120}?(?:per\s*gram|\/\s*g|\/\s*gram|gram|克)/gi,
    /(?:per\s*gram|\/\s*g|\/\s*gram|gram|克)[\s\S]{0,160}?(?:S\$|SGD|\$)\s*(?<price>[1-3]\d{2}(?:\.\d{1,2})?)[\s\S]{0,180}?(?:24\s*K|999(?:\.9)?|足金|pure\s*gold|gold\s*price|gold\s*selling\s*price)/gi,
    /(?:S\$|SGD|\$)\s*(?<price>[1-3]\d{2}(?:\.\d{1,2})?)[\s\S]{0,180}?(?:per\s*gram|\/\s*g|\/\s*gram|gram|克)[\s\S]{0,220}?(?:24\s*K|999(?:\.9)?|足金|pure\s*gold|gold\s*price|gold\s*selling\s*price)/gi,
    /(?:24\s*K|999(?:\.9)?|足金|pure\s*gold|gold\s*selling\s*price)[\s\S]{0,220}?(?:S\$|SGD|\$)\s*(?<price>[1-3]\d{2}(?:\.\d{1,2})?)/gi
  ];

  const candidates = extractCandidates(text, patterns)
    .filter((candidate) => qualityClue.test(candidate.raw))
    .filter((candidate) => unitClue.test(candidate.raw) || /(?:24\s*K|999|足金|pure\s*gold)/i.test(candidate.raw))
    .filter((candidate) => !rejectClue.test(candidate.raw));

  if (!candidates.length) {
    throw new Error("24K / 999 Gold price not found on Chow Tai Fook Singapore Pure Gold page. No valid SGD 150-400 per gram candidate found.");
  }

  candidates.sort((a, b) => {
    const score = (candidate) => {
      let value = 0;
      if (/Today'?s/i.test(candidate.raw)) value += 5;
      if (/24\s*K/i.test(candidate.raw)) value += 5;
      if (/999/i.test(candidate.raw)) value += 5;
      if (/Selling\s+Price/i.test(candidate.raw)) value += 5;
      if (/pure\s*gold/i.test(candidate.raw)) value += 3;
      if (unitClue.test(candidate.raw)) value += 4;
      if (/per\s*gram|\/\s*g|\/\s*gram/i.test(candidate.raw)) value += 3;
      return value;
    };
    return score(b) - score(a);
  });

  return buildResult(candidates[0].raw, candidates[0].price);
}

function withCacheBuster(url) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}_=${Date.now()}`;
}

async function fetchStaticContent(source) {
  const response = await fetch(withCacheBuster(source.url), {
    headers: {
      ...BROWSER_HEADERS,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    },
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`Static fetch failed: HTTP ${response.status}`);
  return await response.text();
}

async function fetchRenderedContent(browser, source) {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    locale: "en-SG",
    extraHTTPHeaders: BROWSER_HEADERS,
    viewport: { width: 1366, height: 900 }
  });

  const page = await context.newPage();
  try {
    await page.route("**/*", async (route) => {
      const request = route.request();
      const resourceType = request.resourceType();
      const url = request.url();
      if (["image", "font", "media"].includes(resourceType) || /google-analytics|googletagmanager|doubleclick|facebook|tiktok|hotjar/i.test(url)) {
        await route.abort().catch(() => {});
        return;
      }
      await route.continue({ headers: { ...request.headers(), "cache-control": "no-cache", "pragma": "no-cache" } });
    });
    await page.goto(withCacheBuster(source.url), { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
    const html = await page.content();
    return `${bodyText}\n\n${html}`;
  } finally {
    await context.close();
  }
}

async function fetchSourceContent(browser, source) {
  const errors = [];
  try {
    const staticContent = await fetchStaticContent(source);
    try {
      source.parser(staticContent);
      return staticContent;
    } catch (error) {
      errors.push(`static: ${error.message}`);
    }
  } catch (error) {
    errors.push(`static: ${error.message}`);
  }

  try {
    return await fetchRenderedContent(browser, source);
  } catch (error) {
    errors.push(`rendered: ${error.message}`);
    throw new Error(errors.join(" | "));
  }
}

async function readJson(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, "utf8")); } catch { return fallback; }
}

async function writeJson(path, data) {
  await fs.mkdir(path.split("/").slice(0, -1).join("/"), { recursive: true });
  await fs.writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("Telegram secrets are not set. Skipping Telegram notification.");
    return;
  }
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true })
  });
  const resultText = await response.text();
  if (!response.ok) console.log("Telegram notification failed:", response.status, resultText);
}

function formatChangeLine(previous, current) {
  const direction = current.change > 0 ? "📈" : "📉";
  const sign = current.change > 0 ? "+" : "";
  return `${direction} ${current.brand}\nSGD ${Number(previous.price).toFixed(2)} → SGD ${Number(current.price).toFixed(2)} / gram\n${sign}${current.change.toFixed(2)} SGD/g`;
}

function formatStatusAlert(previous, current) {
  if (current.status === "error") return `⚠️ ${current.brand}\n讀取失敗：${current.error}`;
  if (previous?.status === "error" && current.status === "ok") return `✅ ${current.brand}\n讀取恢復：SGD ${Number(current.price).toFixed(2)} / gram`;
  return null;
}

function findLastOkItem(history, sourceId) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = (history[index].items || []).find((entry) => entry.id === sourceId);
    if (item?.status === "ok" && isValidGoldPrice(Number(item.price))) return item;
  }
  return null;
}

function fallbackItemFromPrevious(source, prev, error, checkedAt) {
  if (prev?.status === "ok" && isValidGoldPrice(Number(prev.price))) {
    return {
      ...prev,
      brand: source.brand,
      label: source.label,
      url: source.url,
      status: "ok",
      stale: true,
      lastError: error.message,
      checkedAt
    };
  }
  return {
    id: source.id,
    brand: source.brand,
    label: source.label,
    url: source.url,
    status: "error",
    error: error.message,
    previousPrice: prev?.price ?? null,
    checkedAt
  };
}

async function main() {
  const previous = await readJson("data/latest.json", { items: [] });
  const history = await readJson("data/history.json", []);
  const latestPreviousById = new Map((previous.items || []).map((item) => [item.id, item]));
  const previousById = new Map();
  for (const source of SOURCES) {
    const latestItem = latestPreviousById.get(source.id);
    previousById.set(source.id, latestItem?.status === "ok" ? latestItem : findLastOkItem(history, source.id) || latestItem);
  }
  const checkedAt = new Date().toISOString();
  const items = [];
  const changes = [];
  const statusAlerts = [];

  const browser = await chromium.launch({ headless: true });
  try {
    for (const source of SOURCES) {
      const prev = previousById.get(source.id);
      try {
        const content = await fetchSourceContent(browser, source);
        const parsed = source.parser(content);
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
        const statusAlert = formatStatusAlert(latestPreviousById.get(source.id), item);
        if (statusAlert) statusAlerts.push(statusAlert);
        items.push(item);
      } catch (error) {
        const item = fallbackItemFromPrevious(source, prev, error, checkedAt);
        if (item.status === "error" && latestPreviousById.get(source.id)?.status !== "error") {
          const statusAlert = formatStatusAlert(latestPreviousById.get(source.id), item);
          if (statusAlert) statusAlerts.push(statusAlert);
        }
        items.push(item);
      }
    }
  } finally {
    await browser.close();
  }

  const latest = { updatedAt: checkedAt, timezone: "Asia/Singapore", items };
  history.push(latest);
  await writeJson("data/latest.json", latest);
  await writeJson("data/history.json", history.slice(-500));

  console.log(items.map((i) => i.status === "ok" ? `${i.brand}: SGD ${i.price.toFixed(2)} / gram (${i.stale ? "stale fallback" : i.rawText})` : `${i.brand}: ${i.error}`).join("\n"));

  const alertLines = [
    ...changes.map(({ previous, current }) => formatChangeLine(previous, current)),
    ...statusAlerts
  ];

  if (alertLines.length) {
    const message = ["🔔 新加坡 24K / 999 金價監察更新", "", ...alertLines, "", `更新時間：${checkedAt}`].join("\n");
    await sendTelegram(message);
  } else {
    console.log("No price/status changes detected. Telegram notification not sent.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

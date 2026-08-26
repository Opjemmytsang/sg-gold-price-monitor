import fs from "node:fs/promises";
import { chromium } from "playwright";

const MIN_VALID_PRICE = 150;
const MAX_VALID_PRICE = 400;
const VERIFY_ATTEMPTS = 3;
const VERIFY_REQUIRED_MATCHES = 2;
const MAX_REASONABLE_PRICE_CHANGE = 5;
const POH_HENG_ID = "poh-heng-24k-999";
const CTF_ID = "chow-tai-fook-sg-24k-999";

const SOURCES = [
  {
    id: POH_HENG_ID,
    brand: "Poh Heng",
    label: "24K / 999",
    url: "https://pohheng.com.sg/",
    parser: parsePohHeng24K999,
    renderedOnly: true
  },
  {
    id: CTF_ID,
    brand: "Chow Tai Fook SG",
    label: "24K / 999",
    url: "https://www.chowtaifook.com/sg/eshop/jewellery/pure-gold",
    parser: parseChowTaiFook24K999,
    renderedOnly: false
  }
];

const BROWSER_HEADERS = {
  "accept-language": "en-SG,en;q=0.9,zh-HK;q=0.8,zh;q=0.7",
  "cache-control": "no-cache, no-store, max-age=0",
  pragma: "no-cache"
};

function decodeEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#36;/g, "$")
    .replace(/&dollar;/g, "$")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function normalizeText(input) {
  return decodeEntities(input)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isValidGoldPrice(value) {
  return Number.isFinite(value) && value >= MIN_VALID_PRICE && value <= MAX_VALID_PRICE;
}

function toNumber(value) {
  return Number(String(value || "").replace(/,/g, ""));
}

function buildResult(rawText, price, method) {
  const value = Number(price);
  if (!isValidGoldPrice(value)) {
    throw new Error(`Rejected invalid gold price candidate: ${price}`);
  }
  return {
    price: value,
    currency: "SGD",
    unit: "gram",
    rawText: normalizeText(rawText).slice(0, 220),
    readMethod: method
  };
}

function parsePohHeng24K999(content, method = "rendered") {
  const text = normalizeText(content);
  const match = text.match(/24\s*K\s*\/\s*999(?:\.\d+)?\s*at\s*(?:S\$|SGD|\$)\s*([1-3]\d{2}(?:\.\d{1,2})?)\s*\/\s*(?:g|gram)/i);
  if (!match) {
    throw new Error("Cannot find Poh Heng exact 24K / 999 price line.");
  }
  return buildResult(match[0], toNumber(match[1]), method);
}

function parseChowTaiFook24K999(content, method = "rendered") {
  const text = normalizeText(content);
  const patterns = [
    /Today'?s\s+999(?:\.9)?\s+Gold\s+Selling\s+Price\s*(?:S\$|SGD|\$)\s*([1-3]\d{2}(?:\.\d{1,2})?)\s*\/\s*(?:g|gram)/i,
    /999(?:\.9)?\s+Gold\s+Selling\s+Price\s*(?:S\$|SGD|\$)\s*([1-3]\d{2}(?:\.\d{1,2})?)\s*\/\s*(?:g|gram)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && !/pendant|ring|bracelet|necklace|earrings|product|formatted|decimalPrice|sku|item/i.test(match[0])) {
      return buildResult(match[0], toNumber(match[1]), method);
    }
  }

  throw new Error("CTF site-wide 999.9 Gold Selling Price not found. Product prices are ignored.");
}

function cacheBustedUrl(url) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}_=${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRenderedContent(browser, source) {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    locale: "en-SG",
    extraHTTPHeaders: BROWSER_HEADERS,
    viewport: { width: 1366, height: 900 },
    serviceWorkers: "block"
  });

  const page = await context.newPage();
  try {
    await page.route("**/*", async (route) => {
      const request = route.request();
      const type = request.resourceType();
      const requestUrl = request.url();
      if (["image", "font", "media"].includes(type) || /google-analytics|googletagmanager|doubleclick|facebook|tiktok|hotjar/i.test(requestUrl)) {
        await route.abort().catch(() => {});
        return;
      }
      await route.continue({
        headers: {
          ...request.headers(),
          ...BROWSER_HEADERS
        }
      });
    });

    await page.goto(cacheBustedUrl(source.url), {
      waitUntil: "domcontentloaded",
      timeout: 35000
    });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2500);

    const bodyText = await page.locator("body").innerText({ timeout: 10000 });
    return bodyText;
  } finally {
    await context.close();
  }
}

async function fetchStaticContent(source) {
  const response = await fetch(cacheBustedUrl(source.url), {
    headers: {
      ...BROWSER_HEADERS,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    },
    redirect: "follow"
  });
  if (!response.ok) {
    throw new Error(`Static fetch failed: HTTP ${response.status}`);
  }
  return response.text();
}

async function readSourceOnce(browser, source) {
  const errors = [];

  try {
    const rendered = await fetchRenderedContent(browser, source);
    return source.parser(rendered, "rendered");
  } catch (error) {
    errors.push(`rendered: ${error.message}`);
  }

  if (!source.renderedOnly) {
    try {
      const html = await fetchStaticContent(source);
      return source.parser(html, "static-fallback");
    } catch (error) {
      errors.push(`static: ${error.message}`);
    }
  }

  throw new Error(errors.join(" | "));
}

async function fetchVerifiedParsed(browser, source) {
  const attempts = [];
  const errors = [];

  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt += 1) {
    try {
      const parsed = await readSourceOnce(browser, source);
      attempts.push({ attempt, ...parsed });
    } catch (error) {
      errors.push(`attempt ${attempt}: ${error.message}`);
    }
    if (attempt < VERIFY_ATTEMPTS) await sleep(1200);
  }

  if (!attempts.length) {
    throw new Error(`No successful price read. ${errors.join(" | ")}`);
  }

  const groups = new Map();
  for (const result of attempts) {
    const key = Number(result.price).toFixed(2);
    const group = groups.get(key) || [];
    group.push(result);
    groups.set(key, group);
  }

  const confirmed = [...groups.values()]
    .filter((group) => group.length >= VERIFY_REQUIRED_MATCHES)
    .sort((a, b) => b.length - a.length)[0];

  if (!confirmed) {
    const readings = attempts.map((item) => `SGD ${Number(item.price).toFixed(2)}`).join(", ");
    throw new Error(`Unstable price readings; no consensus reached. Readings: ${readings}.`);
  }

  const chosen = confirmed[0];
  return {
    ...chosen,
    verification: {
      attempts: attempts.length,
      matchedAttempts: confirmed.length,
      method: `multi-read consensus (${chosen.readMethod})`
    }
  };
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

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true
    })
  });

  if (!response.ok) {
    console.log("Telegram notification failed:", response.status, await response.text());
  }
}

function formatChangeLine(previous, current) {
  const direction = current.change > 0 ? "📈" : "📉";
  const sign = current.change > 0 ? "+" : "";
  return `${direction} ${current.brand}\nSGD ${Number(previous.price).toFixed(2)} → SGD ${Number(current.price).toFixed(2)} / gram\n${sign}${current.change.toFixed(2)} SGD/g`;
}

function fallbackFromPrevious(source, previous, error, checkedAt) {
  if (previous?.status === "ok" && isValidGoldPrice(Number(previous.price))) {
    return {
      ...previous,
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
    checkedAt
  };
}

function applyLargeMoveGuard(previous, current, checkedAt) {
  if (previous?.status !== "ok" || !isValidGoldPrice(Number(previous.price))) return current;

  const previousPrice = Number(previous.price);
  const currentPrice = Number(current.price);
  const change = Number((currentPrice - previousPrice).toFixed(2));

  if (Math.abs(change) <= MAX_REASONABLE_PRICE_CHANGE) return current;

  if (Number(previous.pendingCandidatePrice) === currentPrice) {
    return {
      ...current,
      previousPrice,
      change,
      confirmedFromPending: true
    };
  }

  return {
    ...previous,
    brand: current.brand,
    label: current.label,
    url: current.url,
    status: "ok",
    stale: true,
    pendingConfirmation: true,
    pendingCandidatePrice: currentPrice,
    pendingCandidateRawText: current.rawText,
    pendingCandidateCheckedAt: checkedAt,
    lastError: `Large move pending confirmation: SGD ${previousPrice.toFixed(2)} → SGD ${currentPrice.toFixed(2)}.`,
    checkedAt
  };
}

async function main() {
  const previous = await readJson("data/latest.json", { items: [] });
  const history = await readJson("data/history.json", []);
  const previousById = new Map((previous.items || []).map((item) => [item.id, item]));
  const checkedAt = new Date().toISOString();
  const items = [];
  const changes = [];

  const browser = await chromium.launch({ headless: true });
  try {
    for (const source of SOURCES) {
      const prev = previousById.get(source.id);
      try {
        const parsed = await fetchVerifiedParsed(browser, source);
        const parsedItem = {
          id: source.id,
          brand: source.brand,
          label: source.label,
          url: source.url,
          status: "ok",
          price: Number(parsed.price),
          currency: parsed.currency,
          unit: parsed.unit,
          rawText: parsed.rawText,
          verification: parsed.verification,
          checkedAt
        };

        const item = applyLargeMoveGuard(prev, parsedItem, checkedAt);
        if (prev?.status === "ok" && Number(prev.price) !== Number(item.price) && !item.pendingConfirmation) {
          item.previousPrice = Number(prev.price);
          item.change = Number((Number(item.price) - Number(prev.price)).toFixed(2));
          changes.push({ previous: prev, current: item });
        }
        items.push(item);
      } catch (error) {
        items.push(fallbackFromPrevious(source, prev, error, checkedAt));
      }
    }
  } finally {
    await browser.close();
  }

  const latest = {
    updatedAt: checkedAt,
    timezone: "Asia/Singapore",
    items
  };

  history.push(latest);
  await writeJson("data/latest.json", latest);
  await writeJson("data/history.json", history.slice(-500));

  console.log(items.map((item) => {
    if (item.status !== "ok") return `${item.brand}: ERROR ${item.error}`;
    const state = item.pendingConfirmation ? "pending confirmation" : item.stale ? "stale fallback" : item.rawText;
    return `${item.brand}: SGD ${Number(item.price).toFixed(2)} / gram (${state})`;
  }).join("\n"));

  if (changes.length) {
    const message = [
      "🔔 新加坡 24K / 999 金價監察更新",
      "",
      ...changes.map(({ previous: prev, current }) => formatChangeLine(prev, current)),
      "",
      `更新時間：${checkedAt}`
    ].join("\n");
    await sendTelegram(message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

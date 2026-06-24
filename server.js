const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const CACHE_FILE = path.join(DATA_DIR, "feed-cache.json");

loadDotEnv(path.join(ROOT, ".env"));

const CONFIG = {
  username: process.env.MALFINI_USERNAME,
  password: process.env.MALFINI_PASSWORD,
  baseUrl: process.env.MALFINI_API_BASE_URL || "https://api.malfini.com",
  port: Number(process.env.PORT || 5177)
};

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function ensureConfig() {
  if (!CONFIG.username || !CONFIG.password) {
    throw new Error("Missing MALFINI_USERNAME or MALFINI_PASSWORD. Create .env from .env.example.");
  }
}

async function malfiniLogin() {
  ensureConfig();
  const res = await fetch(`${CONFIG.baseUrl}/api/v4/api-auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: CONFIG.username, password: CONFIG.password })
  });
  if (!res.ok) throw new Error(`Malfini login failed: HTTP ${res.status}`);
  const body = await res.json();
  if (!body.access_token) throw new Error("Malfini login response did not include access_token.");
  return body;
}

async function malfiniGet(endpoint, token) {
  const res = await fetch(`${CONFIG.baseUrl}${endpoint}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`${endpoint} failed: HTTP ${res.status}`);
  return res.json();
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function choosePrice(rows) {
  if (!rows || rows.length === 0) return null;
  return [...rows].sort((a, b) => Number(a.limit || 0) - Number(b.limit || 0))[0];
}

function stockSummary(rows) {
  const today = new Date().toISOString().slice(0, 10);
  let current = 0;
  let future = 0;
  for (const row of rows || []) {
    const qty = Number(row.quantity || 0);
    if (!row.date || String(row.date).slice(0, 10) <= today) current += qty;
    else future += qty;
  }
  return { current, future };
}

function normalizeFeeds({ products, availabilities, prices, recommendedPrices, previous }) {
  const availabilityMap = groupBy(availabilities, (row) => row.productSizeCode);
  const priceMap = groupBy(prices, (row) => row.productSizeCode);
  const recommendedMap = groupBy(recommendedPrices, (row) => row.productSizeCode);
  const previousSizes = new Map((previous?.flatSizes || []).map((size) => [size.productSizeCode, size]));

  const flatSizes = [];
  const flatProducts = (products || []).map((product) => {
    const variants = (product.variants || []).map((variant) => {
      const primaryImage = (variant.images || []).find((image) => image.viewCode === "c") || (variant.images || [])[0] || null;
      const attributes = Object.fromEntries((variant.attributes || []).map((item) => [item.code || item.title, item.text]));
      const sizes = (variant.nomenclatures || []).map((size) => {
        const stock = stockSummary(availabilityMap.get(size.productSizeCode));
        const wholesale = choosePrice(priceMap.get(size.productSizeCode));
        const recommended = choosePrice(recommendedMap.get(size.productSizeCode));
        const skuCode = `${product.code}${variant.colorCode}${size.sizeCode}`;
        const productGroupId = `${product.code}${variant.colorCode}`;
        const normalizedSize = {
          code: skuCode,
          pairCode: product.code,
          modelColorCode: variant.code,
          manufacturer: product.trademark,
          productGroupId,
          productCode: product.code,
          productName: product.name,
          variantCode: variant.code,
          color: variant.name,
          colorCode: variant.colorCode,
          productSizeCode: size.productSizeCode,
          ean: size.ean,
          sizeName: size.sizeName,
          sizeCode: size.sizeCode,
          currentStock: stock.current,
          futureStock: stock.future,
          wholesalePrice: wholesale?.price ?? null,
          wholesaleCurrency: wholesale?.currency ?? null,
          recommendedPrice: recommended?.price ?? null,
          recommendedCurrency: recommended?.currency ?? null,
          image: primaryImage?.link ?? null,
          images: (variant.images || []).map((image) => ({ viewCode: image.viewCode, link: image.link }))
        };
        flatSizes.push(normalizedSize);
        return normalizedSize;
      });
      return {
        code: variant.code,
        color: variant.name,
        colorCode: variant.colorCode,
        colorIcon: variant.colorIconLink,
        image: primaryImage?.link ?? null,
        attributes,
        sizes
      };
    });

    return {
      code: product.code,
      name: product.name,
      categoryName: product.categoryName,
      categoryCode: product.categoryCode,
      gender: product.gender,
      trademark: product.trademark,
      type: product.type,
      subtitle: product.subtitle,
      specification: product.specification,
      description: product.description,
      productCardPdf: product.productCardPdf,
      sizeChartPdf: product.sizeChartPdf,
      variants
    };
  });

  const changes = {
    newSizes: [],
    removedSizes: [],
    stockChanged: [],
    priceChanged: []
  };
  const currentCodes = new Set(flatSizes.map((size) => size.productSizeCode));
  for (const size of flatSizes) {
    const old = previousSizes.get(size.productSizeCode);
    if (!old) {
      changes.newSizes.push(size);
      continue;
    }
    if (Number(old.currentStock || 0) !== Number(size.currentStock || 0)) {
      changes.stockChanged.push({ before: old, after: size });
    }
    if (Number(old.wholesalePrice || 0) !== Number(size.wholesalePrice || 0)) {
      changes.priceChanged.push({ before: old, after: size });
    }
  }
  for (const [code, old] of previousSizes.entries()) {
    if (!currentCodes.has(code)) changes.removedSizes.push(old);
  }

  const categories = {};
  for (const product of flatProducts) {
    const key = product.categoryName || "Uncategorized";
    categories[key] = (categories[key] || 0) + 1;
  }

  const missingEan = flatSizes.filter((size) => !size.ean).length;
  const missingImage = flatSizes.filter((size) => !size.image).length;
  const inStock = flatSizes.filter((size) => Number(size.currentStock || 0) > 0).length;
  const priced = flatSizes.filter((size) => size.wholesalePrice !== null).length;
  const totalStock = flatSizes.reduce((sum, size) => sum + Number(size.currentStock || 0), 0);
  const missingProductType = flatProducts.filter((product) => !product.categoryName).length;
  const qualityIssues = missingEan + missingImage + (flatSizes.length - priced) + missingProductType;
  const qualityScore = flatSizes.length ? Math.max(0, Math.round((1 - qualityIssues / flatSizes.length) * 100)) : 0;
  const categoryStats = buildCategoryStats(flatSizes, flatProducts);
  const priceBuckets = buildPriceBuckets(flatSizes);
  const previousHistory = Array.isArray(previous?.importHistory) ? previous.importHistory : [];
  const historyEntry = {
    importedAt: new Date().toISOString(),
    products: flatProducts.length,
    variants: flatProducts.reduce((sum, product) => sum + product.variants.length, 0),
    sizes: flatSizes.length,
    totalStock,
    inStock,
    outOfStock: flatSizes.length - inStock,
    missingEan,
    missingImage,
    missingPrice: flatSizes.length - priced,
    qualityScore
  };
  const importHistory = [...previousHistory, historyEntry].slice(-90);
  const previousStockSnapshots = Array.isArray(previous?.stockSnapshots) && previous.stockSnapshots.length
    ? previous.stockSnapshots
    : previous?.flatSizes?.length
      ? [buildStockSnapshot(previous.importedAt, previous.flatSizes)]
      : [];
  const stockSnapshot = buildStockSnapshot(historyEntry.importedAt, flatSizes);
  const stockSnapshots = [...previousStockSnapshots, stockSnapshot].slice(-45);

  return {
    importedAt: historyEntry.importedAt,
    source: CONFIG.baseUrl,
    counts: {
      products: flatProducts.length,
      variants: flatProducts.reduce((sum, product) => sum + product.variants.length, 0),
      sizes: flatSizes.length,
      availabilityRows: (availabilities || []).length,
      priceRows: (prices || []).length,
      recommendedPriceRows: (recommendedPrices || []).length,
      totalStock,
      inStock,
      outOfStock: flatSizes.length - inStock,
      priced,
      missingPrice: flatSizes.length - priced,
      missingEan,
      missingImage,
      missingProductType,
      qualityScore
    },
    categories,
    categoryStats,
    priceBuckets,
    importHistory,
    stockSnapshots,
    products: flatProducts,
    flatSizes,
    changes
  };
}

function buildStockSnapshot(importedAt, rows) {
  return {
    importedAt: importedAt || new Date().toISOString(),
    rows: (rows || []).map((size) => ({
      code: size.code,
      productSizeCode: size.productSizeCode,
      pairCode: size.pairCode,
      productCode: size.productCode,
      productName: size.productName,
      color: size.color,
      colorCode: size.colorCode,
      sizeName: size.sizeName,
      sizeCode: size.sizeCode,
      currentStock: Number(size.currentStock || 0)
    }))
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildFeedCsv(data) {
  const headers = [
    "sku",
    "product",
    "pairCode",
    "productId",
    "manufacturer",
    "productName",
    "category",
    "color",
    "colorCode",
    "size",
    "sizeCode",
    "ean",
    "stock",
    "futureStock",
    "PA",
    "PA_currency",
    "MSRP",
    "MSRP_currency",
    "image"
  ];
  const categoryByProduct = new Map((data.products || []).map((product) => [product.code, product.categoryName || "Uncategorized"]));
  const rows = (data.flatSizes || []).map((row) => [
    row.code,
    row.productGroupId,
    row.pairCode,
    row.productCode,
    row.manufacturer,
    row.productName,
    categoryByProduct.get(row.productCode) || "Uncategorized",
    row.color,
    row.colorCode,
    row.sizeName,
    row.sizeCode,
    row.ean,
    row.currentStock,
    row.futureStock,
    row.wholesalePrice,
    row.wholesaleCurrency,
    row.recommendedPrice,
    row.recommendedCurrency,
    row.image
  ]);
  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

function csv(res, filename, content) {
  const payload = Buffer.from(content, "utf8");
  res.writeHead(200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`,
    "content-length": payload.length
  });
  res.end(payload);
}

function buildCategoryStats(flatSizes, flatProducts) {
  const categoryByProduct = new Map(flatProducts.map((product) => [product.code, product.categoryName || "Uncategorized"]));
  const stats = new Map();
  for (const size of flatSizes) {
    const category = categoryByProduct.get(size.productCode) || "Uncategorized";
    if (!stats.has(category)) {
      stats.set(category, { category, variants: 0, totalStock: 0, totalRecommendedPrice: 0, priced: 0, currency: null });
    }
    const row = stats.get(category);
    row.variants += 1;
    row.totalStock += Number(size.currentStock || 0);
    if (size.recommendedPrice !== null && size.recommendedPrice !== undefined) {
      row.totalRecommendedPrice += Number(size.recommendedPrice || 0);
      row.priced += 1;
      row.currency = row.currency || size.recommendedCurrency;
    }
  }
  return [...stats.values()]
    .map((row) => ({
      ...row,
      averageRecommendedPrice: row.priced ? row.totalRecommendedPrice / row.priced : null
    }))
    .sort((a, b) => b.variants - a.variants);
}

function buildPriceBuckets(flatSizes) {
  const buckets = [
    { label: "0-5", min: 0, max: 5, count: 0 },
    { label: "5-10", min: 5, max: 10, count: 0 },
    { label: "10-20", min: 10, max: 20, count: 0 },
    { label: "20-40", min: 20, max: 40, count: 0 },
    { label: "40+", min: 40, max: Infinity, count: 0 }
  ];
  for (const size of flatSizes) {
    const price = Number(size.recommendedPrice || 0);
    const bucket = buckets.find((item) => price >= item.min && price < item.max);
    if (bucket) bucket.count += 1;
  }
  return buckets.map(({ label, count }) => ({ label, count }));
}

function readCache() {
  if (!fs.existsSync(CACHE_FILE)) return null;
  return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
}

function writeCache(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
}

async function importFeeds() {
  const startedAt = Date.now();
  const previous = readCache();
  const login = await malfiniLogin();
  const token = login.access_token;
  const [products, availabilities, prices, recommendedPrices] = await Promise.all([
    malfiniGet("/api/v4/product?language=en", token),
    malfiniGet("/api/v4/product/availabilities?includeFuture=true", token),
    malfiniGet("/api/v4/product/prices", token),
    malfiniGet("/api/v4/product/recommended-prices", token)
  ]);

  const normalized = normalizeFeeds({ products, availabilities, prices, recommendedPrices, previous });
  normalized.importRun = {
    status: "success",
    durationMs: Date.now() - startedAt,
    tokenExpiresIn: login.expires_in
  };
  writeCache(normalized);
  return normalized;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function serveStatic(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname === "/" ? "/index.html" : reqUrl.pathname;
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };
  res.writeHead(200, { "content-type": types[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (reqUrl.pathname === "/api/status") {
      return json(res, 200, {
        configured: Boolean(CONFIG.username && CONFIG.password),
        cacheExists: fs.existsSync(CACHE_FILE),
        baseUrl: CONFIG.baseUrl
      });
    }
    if (reqUrl.pathname === "/api/import" && req.method === "POST") {
      const data = await importFeeds();
      return json(res, 200, data);
    }
    if (reqUrl.pathname === "/api/dashboard") {
      if (reqUrl.searchParams.get("refresh") === "1") {
        const data = await importFeeds();
        return json(res, 200, data);
      }
      const cache = readCache();
      if (!cache) return json(res, 404, { error: "No import cache yet. Run an import first." });
      return json(res, 200, cache);
    }
    if (reqUrl.pathname === "/api/export.csv") {
      const cache = readCache();
      if (!cache) return json(res, 404, { error: "No import cache yet. Run an import first." });
      const stamp = new Date(cache.importedAt || Date.now()).toISOString().slice(0, 10);
      return csv(res, `malfini-feed-${stamp}.csv`, buildFeedCsv(cache));
    }
    if (reqUrl.pathname.startsWith("/api/product/")) {
      const productCode = decodeURIComponent(reqUrl.pathname.replace("/api/product/", ""));
      if (!productCode) return json(res, 400, { error: "Missing product code" });
      const login = await malfiniLogin();
      const products = await malfiniGet(`/api/v4/product?language=en&productCodes=${encodeURIComponent(productCode)}`, login.access_token);
      return json(res, 200, Array.isArray(products) ? products[0] : products);
    }
    return json(res, 404, { error: "Unknown API route" });
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
}

async function main() {
  if (process.argv.includes("--import")) {
    const data = await importFeeds();
    console.log(`Imported ${data.counts.products} products, ${data.counts.sizes} sizes.`);
    return;
  }

  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      handleApi(req, res);
      return;
    }
    serveStatic(req, res);
  });
  server.listen(CONFIG.port, () => {
    console.log(`Malfini dashboard running at http://localhost:${CONFIG.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

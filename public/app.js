const state = {
  data: null,
  rows: [],
  expandedGroups: new Set(),
  categoryByProductCode: new Map(),
  staticMode: false,
  sortKey: "product",
  sortDirection: "asc"
};

const els = {
  themeToggle: document.querySelector("#themeToggle"),
  stickyFeedState: document.querySelector("#stickyFeedState"),
  stickyImportState: document.querySelector("#stickyImportState"),
  status: document.querySelector("#status"),
  refreshBtn: document.querySelector("#refreshBtn"),
  reloadBtn: document.querySelector("#reloadBtn"),
  fullExportBtn: document.querySelector("#fullExportBtn"),
  searchInput: document.querySelector("#searchInput"),
  categoryFilter: document.querySelector("#categoryFilter"),
  manufacturerFilter: document.querySelector("#manufacturerFilter"),
  stockFilter: document.querySelector("#stockFilter"),
  eanFilter: document.querySelector("#eanFilter"),
  pageSizeSelect: document.querySelector("#pageSizeSelect"),
  groupProductsToggle: document.querySelector("#groupProductsToggle"),
  activeFilters: document.querySelector("#activeFilters"),
  clearFiltersBtn: document.querySelector("#clearFiltersBtn"),
  exportFilteredBtn: document.querySelector("#exportFilteredBtn"),
  productRows: document.querySelector("#productRows"),
  resultCount: document.querySelector("#resultCount"),
  periodPreset: document.querySelector("#periodPreset"),
  periodStart: document.querySelector("#periodStart"),
  periodEnd: document.querySelector("#periodEnd"),
  applyPeriodBtn: document.querySelector("#applyPeriodBtn"),
  periodSummary: document.querySelector("#periodSummary"),
  periodMovementBody: document.querySelector("#periodMovementBody"),
  changes: document.querySelector("#changes"),
  quality: document.querySelector("#quality"),
  qualityDetail: document.querySelector("#qualityDetail"),
  recentUpdatesBody: document.querySelector("#recentUpdatesBody"),
  newProductsBody: document.querySelector("#newProductsBody"),
  stockMoversBody: document.querySelector("#stockMoversBody"),
  productTypesBody: document.querySelector("#productTypesBody"),
  historyBody: document.querySelector("#historyBody"),
  lastUpdated: document.querySelector("#lastUpdated"),
  alert: document.querySelector("#alert")
};

const savedTheme = localStorage.getItem("malfini-theme") || "dark";
document.documentElement.dataset.theme = savedTheme;
els.themeToggle.textContent = savedTheme === "dark" ? "Light mode" : "Dark mode";

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(Number(value || 0));
}

function formatMoney(value, currency) {
  if (value === null || value === undefined) return "-";
  const code = currency || "EUR";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function setText(id, value) {
  document.querySelector(`#${id}`).textContent = formatNumber(value);
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
  els.stickyFeedState.textContent = isError ? "Feed issue" : "Feed OK";
  if (els.alert) {
    els.alert.hidden = !isError;
    els.alert.textContent = isError ? message : "";
  }
}

function setRunningStatus(message, detail = "Working on the feed...") {
  els.status.textContent = detail;
  els.status.classList.remove("error");
  els.stickyFeedState.textContent = message;
  if (els.alert) els.alert.hidden = true;
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed: HTTP ${res.status}`);
  return body;
}

async function fetchDashboardSnapshot(refresh = false) {
  if (refresh) {
    state.staticMode = false;
    return fetchJson("api/import", { method: "POST" });
  }
  try {
    const data = await fetchJson("api/dashboard");
    state.staticMode = false;
    return data;
  } catch (error) {
    const manifest = await fetchJson(`feed-version.json?v=${Date.now()}`).catch(() => ({ feedPath: "data/feed-cache.json" }));
    const data = await fetchJson(`${manifest.feedPath || "data/feed-cache.json"}?v=${Date.now()}`);
    state.staticMode = true;
    return data;
  }
}

async function loadDashboard(refresh = false) {
  if (refresh && state.staticMode) {
    setStatus("Online snapshot is read-only. Run the local dashboard to import the latest API.", true);
    return;
  }
  els.refreshBtn.disabled = true;
  els.reloadBtn.disabled = true;
  els.fullExportBtn.disabled = true;
  setRunningStatus(
    refresh ? "Importing latest API..." : "Loading snapshot...",
    refresh ? "Fetching products, stock, PA and MSRP from Malfini..." : "Loading the local cached feed..."
  );
  try {
    const data = await fetchDashboardSnapshot(refresh);
    state.data = data;
    state.rows = data.flatSizes || [];
    state.currentRowBySnapshotKey = null;
    state.categoryByProductCode = new Map((data.products || []).map((product) => [product.code, product.categoryName || ""]));
    renderDashboard();
    const importedAt = new Date(data.importedAt).toLocaleString();
    els.lastUpdated.textContent = `Last import: ${importedAt}`;
    els.stickyImportState.textContent = `Last import ${importedAt}`;
    setStatus(`${state.staticMode ? "Online snapshot" : "Ready"} · ${formatNumber(data.counts?.sizes || 0)} SKUs loaded`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    els.refreshBtn.disabled = state.staticMode;
    els.reloadBtn.disabled = false;
    els.fullExportBtn.disabled = !state.rows.length;
    if (state.staticMode) {
      els.refreshBtn.title = "GitHub Pages is read-only. Import from the local dashboard.";
    } else {
      els.refreshBtn.title = "Import latest feed";
    }
  }
}

function renderDashboard() {
  const { counts } = state.data;
  setText("productsCount", counts.products);
  setText("variantsCount", counts.variants);
  setText("sizesCount", counts.sizes);
  setText("inStockCount", counts.inStock);
  setText("outStockCount", counts.outOfStock);
  document.querySelector("#totalStockCount").textContent = formatCompactNumber(counts.totalStock);
  setText("missingEanCount", counts.missingEan);
  document.querySelector("#qualityScoreCount").textContent = `${counts.qualityScore || 0}%`;
  renderCategoryFilter();
  renderManufacturerFilter();
  renderChanges();
  renderQuality();
  renderCharts();
  renderHistory();
  renderPeriodSections();
  renderQualityDetail();
  renderNewProducts();
  renderProductTypes();
  renderRows();
}

function renderCategoryFilter() {
  const current = els.categoryFilter.value;
  const categories = Object.keys(state.data.categories || {}).sort();
  els.categoryFilter.innerHTML = `<option value="">All categories</option>`;
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = `${category} (${state.data.categories[category]})`;
    els.categoryFilter.appendChild(option);
  }
  els.categoryFilter.value = categories.includes(current) ? current : "";
}

function renderManufacturerFilter() {
  const current = els.manufacturerFilter.value;
  const counts = {};
  for (const row of state.rows || []) {
    const manufacturer = row.manufacturer || "Unknown";
    counts[manufacturer] = (counts[manufacturer] || 0) + 1;
  }
  const manufacturers = Object.keys(counts).sort((a, b) => a.localeCompare(b));
  els.manufacturerFilter.innerHTML = `<option value="">All manufacturers</option>`;
  for (const manufacturer of manufacturers) {
    const option = document.createElement("option");
    option.value = manufacturer;
    option.textContent = `${manufacturer} (${formatNumber(counts[manufacturer])})`;
    els.manufacturerFilter.appendChild(option);
  }
  els.manufacturerFilter.value = manufacturers.includes(current) ? current : "";
}

function productCategory(productCode) {
  return state.categoryByProductCode.get(productCode) || "";
}

function filteredRows() {
  const query = els.searchInput.value.trim().toLowerCase();
  const category = els.categoryFilter.value;
  const manufacturer = els.manufacturerFilter.value;
  const stock = els.stockFilter.value;
  const ean = els.eanFilter.value;
  return state.rows.filter((row) => {
    const matchesQuery = !query || [
      row.code,
      row.pairCode,
      row.modelColorCode,
      row.manufacturer,
      row.productCode,
      row.productName,
      row.variantCode,
      row.productSizeCode,
      row.ean,
      row.color,
      row.sizeName
    ].some((value) => String(value || "").toLowerCase().includes(query));
    const matchesCategory = !category || productCategory(row.productCode) === category;
    const matchesManufacturer = !manufacturer || (row.manufacturer || "Unknown") === manufacturer;
    const matchesStock =
      !stock ||
      (stock === "in" && Number(row.currentStock || 0) > 0) ||
      (stock === "out" && Number(row.currentStock || 0) <= 0) ||
      (stock === "missing-price" && row.wholesalePrice === null) ||
      (stock === "missing-ean" && !row.ean);
    const matchesEan =
      !ean ||
      (ean === "valid" && Boolean(row.ean)) ||
      (ean === "missing" && !row.ean);
    return matchesQuery && matchesCategory && matchesManufacturer && matchesStock && matchesEan;
  });
}

function renderActiveFilters(matchCount = filteredRows().length) {
  const filters = activeFilterItems();
  const countLabel = `${formatNumber(matchCount)} matching ${els.groupProductsToggle.checked ? "SKU rows" : "SKU rows"}`;
  if (!filters.length) {
    els.activeFilters.innerHTML = `<span class="filter-empty">${countLabel} · no filters active</span>`;
  } else {
    els.activeFilters.innerHTML = filters.map((filter) => `
      <span class="filter-chip">
        <span>${escapeHtml(filter.label)}</span>
        ${escapeHtml(filter.value)}
        <button type="button" aria-label="Remove ${escapeHtml(filter.label)} filter" data-filter-key="${escapeHtml(filter.key)}">x</button>
      </span>
    `).join("");
  }
  els.clearFiltersBtn.disabled = filters.length === 0;
  els.exportFilteredBtn.disabled = matchCount === 0;
}

function activeFilterItems() {
  const stockLabels = {
    in: "In stock",
    out: "Out of stock",
    "missing-price": "Missing PA",
    "missing-ean": "Missing EAN"
  };
  const eanLabels = {
    valid: "Valid EAN",
    missing: "Missing barcode"
  };
  return [
    els.searchInput.value.trim() && { key: "search", label: "Search", value: els.searchInput.value.trim() },
    els.categoryFilter.value && { key: "category", label: "Category", value: els.categoryFilter.value },
    els.manufacturerFilter.value && { key: "manufacturer", label: "Manufacturer", value: els.manufacturerFilter.value },
    els.stockFilter.value && { key: "stock", label: "Stock", value: stockLabels[els.stockFilter.value] || els.stockFilter.value },
    els.eanFilter.value && { key: "ean", label: "EAN", value: eanLabels[els.eanFilter.value] || els.eanFilter.value }
  ].filter(Boolean);
}

function clearFilter(key) {
  if (key === "search") els.searchInput.value = "";
  if (key === "category") els.categoryFilter.value = "";
  if (key === "manufacturer") els.manufacturerFilter.value = "";
  if (key === "stock") els.stockFilter.value = "";
  if (key === "ean") els.eanFilter.value = "";
  renderRows();
}

function clearCatalogFilters() {
  els.searchInput.value = "";
  els.categoryFilter.value = "";
  els.manufacturerFilter.value = "";
  els.stockFilter.value = "";
  els.eanFilter.value = "";
  renderRows();
}

function setSort(key) {
  if (state.sortKey === key) {
    state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
  } else {
    state.sortKey = key;
    state.sortDirection = key === "stock" ? "desc" : "asc";
  }
  renderRows();
}

function updateSortButtons() {
  document.querySelectorAll(".sort-button").forEach((button) => {
    const isActive = button.dataset.sortKey === state.sortKey;
    button.classList.toggle("active", isActive);
    button.classList.toggle("asc", isActive && state.sortDirection === "asc");
    button.classList.toggle("desc", isActive && state.sortDirection === "desc");
    button.setAttribute("aria-sort", isActive ? (state.sortDirection === "asc" ? "ascending" : "descending") : "none");
  });
}

function sortRows(rows) {
  return [...rows].sort((a, b) => compareSortValues(rowSortValue(a), rowSortValue(b), a.code, b.code));
}

function sortGroups(groups) {
  return [...groups].sort((a, b) => compareSortValues(groupSortValue(a), groupSortValue(b), a.id, b.id));
}

function rowSortValue(row) {
  if (state.sortKey === "sku") return row.code || row.productSizeCode || "";
  if (state.sortKey === "type") return productCategory(row.productCode);
  if (state.sortKey === "pa") return Number(row.wholesalePrice ?? Number.POSITIVE_INFINITY);
  if (state.sortKey === "msrp") return Number(row.recommendedPrice ?? Number.POSITIVE_INFINITY);
  if (state.sortKey === "stock") return Number(row.currentStock || 0);
  return `${row.productName || ""} ${row.color || ""} ${row.manufacturer || ""}`;
}

function groupSortValue(group) {
  if (state.sortKey === "sku") return group.id || "";
  if (state.sortKey === "type") return group.category || "";
  if (state.sortKey === "pa") return minNumber(group.rows.map((row) => row.wholesalePrice));
  if (state.sortKey === "msrp") return minNumber(group.rows.map((row) => row.recommendedPrice));
  if (state.sortKey === "stock") return group.rows.reduce((sum, row) => sum + Number(row.currentStock || 0), 0);
  return `${group.name || ""} ${group.color || ""} ${group.manufacturer || ""}`;
}

function minNumber(values) {
  const numbers = values.filter((value) => value !== null && value !== undefined).map(Number);
  return numbers.length ? Math.min(...numbers) : Number.POSITIVE_INFINITY;
}

function compareSortValues(left, right, leftFallback, rightFallback) {
  let result;
  if (typeof left === "number" && typeof right === "number") {
    result = left - right;
  } else {
    result = String(left ?? "").localeCompare(String(right ?? ""), undefined, { numeric: true, sensitivity: "base" });
  }
  if (!result) {
    result = String(leftFallback || "").localeCompare(String(rightFallback || ""), undefined, { numeric: true, sensitivity: "base" });
  }
  return state.sortDirection === "asc" ? result : -result;
}

function renderRows() {
  const allRows = filteredRows();
  const pageSize = els.pageSizeSelect.value === "all" ? allRows.length : Number(els.pageSizeSelect.value || 500);
  renderActiveFilters(allRows.length);
  updateSortButtons();
  const rows = sortRows(allRows).slice(0, pageSize);
  if (els.groupProductsToggle.checked) {
    renderGroupedRows(allRows, pageSize);
    return;
  }
  els.resultCount.textContent = `${formatNumber(allRows.length)} SKU rows`;
  els.productRows.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="image-cell">${row.image ? `<img src="${escapeHtml(row.image)}" alt="">` : ""}</td>
      <td>${escapeHtml(row.code || row.productSizeCode || "-")}</td>
      <td>${escapeHtml(row.ean || "-")}</td>
      <td>${productIdentity(row.productName, row.productGroupId, row.color, row.manufacturer)}</td>
      <td>${escapeHtml(productCategory(row.productCode) || "-")}</td>
      <td><span class="status-badge">Active</span></td>
      <td>${priceCell(formatMoney(row.wholesalePrice, row.wholesaleCurrency))}</td>
      <td>${priceCell(formatMoney(row.recommendedPrice, row.recommendedCurrency))}</td>
      <td>${stockBadge(row.currentStock, row.futureStock)}</td>
    `;
    els.productRows.appendChild(tr);
  }
}

function renderGroupedRows(allRows, pageSize) {
  const groups = sortGroups([...groupRowsByProductId(allRows).values()]).slice(0, pageSize);
  els.resultCount.textContent = `${formatNumber(groups.length)} product groups / ${formatNumber(allRows.length)} SKU rows`;
  els.productRows.innerHTML = "";
  for (const group of groups) {
    const tr = document.createElement("tr");
    tr.className = "product-group-row";
    if (state.expandedGroups.has(group.id)) tr.classList.add("expanded");
    const stock = group.rows.reduce((sum, row) => sum + Number(row.currentStock || 0), 0);
    const future = group.rows.reduce((sum, row) => sum + Number(row.futureStock || 0), 0);
    const prices = group.rows.map((row) => row.wholesalePrice).filter((value) => value !== null && value !== undefined);
    const rrps = group.rows.map((row) => row.recommendedPrice).filter((value) => value !== null && value !== undefined);
    const missingEan = group.rows.filter((row) => !row.ean).length;
    const isExpanded = state.expandedGroups.has(group.id);
    tr.innerHTML = `
      <td class="image-cell">${group.image ? `<img src="${escapeHtml(group.image)}" alt="">` : ""}</td>
      <td><button class="show-button" type="button" data-group-id="${escapeHtml(group.id)}">${isExpanded ? "Hide" : "Show"} ${formatNumber(group.rows.length)}</button></td>
      <td>${barcodeBadge(missingEan, group.rows.length)}</td>
      <td>${productIdentity(group.name, group.id, group.color, group.manufacturer)}</td>
      <td>${escapeHtml(group.category || "-")}</td>
      <td><span class="status-badge">Active</span></td>
      <td>${priceCell(priceRange(prices, group.rows[0]?.wholesaleCurrency))}</td>
      <td>${priceCell(priceRange(rrps, group.rows[0]?.recommendedCurrency))}</td>
      <td>${stockBadge(stock, future)}</td>
    `;
    els.productRows.appendChild(tr);
    if (isExpanded) renderGroupDetails(group);
  }
}

function renderGroupDetails(group) {
  const detail = document.createElement("tr");
  detail.className = "variant-detail-row";
  const images = collectGroupImages(group);
  const sizes = [...group.rows].sort(compareSizes);
  const imageTiles = images.map((image) => `
    <a href="${escapeHtml(image.link)}" target="_blank" rel="noreferrer" class="view-tile">
      <img src="${escapeHtml(image.link)}" alt="">
      <span>${escapeHtml(image.viewCode || "view")}</span>
    </a>
  `).join("");
  detail.innerHTML = `
    <td colspan="9">
      <div class="product-drawer" data-group-id="${escapeHtml(group.id)}">
        <div class="drawer-gallery">
          <div class="drawer-gallery-title">Product views</div>
          <div class="view-grid">
            ${imageTiles || `<div class="view-empty">Loading views...</div>`}
          </div>
          <div class="view-status">${images.length > 1 ? `${formatNumber(images.length)} views` : "Checking extra views..."}</div>
        </div>
        <div class="size-panel">
          <div class="size-panel-heading">
            <strong>Sizes</strong>
            <span>${formatNumber(sizes.length)} SKUs</span>
          </div>
          <div class="size-grid">
            ${sizes.map((row) => `
              <article class="size-card">
                <div class="size-token">${escapeHtml(row.sizeName || row.sizeCode || "-")}</div>
                <div class="size-meta">
                  <span>SKU</span><strong>${escapeHtml(row.code || row.productSizeCode || "-")}</strong>
                </div>
                <div class="size-meta">
                  <span>EAN</span><strong>${row.ean ? escapeHtml(row.ean) : "Missing"}</strong>
                </div>
                <div class="size-values">
                  <span>PA ${escapeHtml(formatMoney(row.wholesalePrice, row.wholesaleCurrency))}</span>
                  <span>MSRP ${escapeHtml(formatMoney(row.recommendedPrice, row.recommendedCurrency))}</span>
                </div>
                <div>${stockBadge(row.currentStock, row.futureStock)}</div>
              </article>
            `).join("")}
          </div>
        </div>
      </div>
    </td>
  `;
  els.productRows.appendChild(detail);
  hydrateGroupImages(group);
}

async function hydrateGroupImages(group) {
  const drawer = document.querySelector(`.product-drawer[data-group-id="${CSS.escape(group.id)}"]`);
  if (!drawer) return;
  const currentTiles = drawer.querySelectorAll(".view-tile").length;
  const status = drawer.querySelector(".view-status");
  if (currentTiles > 1) {
    if (status) status.textContent = `${formatNumber(currentTiles)} views`;
    return;
  }
  try {
    const product = await fetchJson(`api/product/${encodeURIComponent(group.pairCode)}`);
    const variants = product?.variants || [];
    const variant = variants.find((item) => sameCode(item.colorCode, group.colorCode))
      || variants.find((item) => sameCode(item.code, group.modelColorCode))
      || variants.find((item) => sameCode(item.code, group.id));
    const images = (variant?.images || []).filter((image) => image.link);
    if (!images.length) {
      if (status) status.textContent = currentTiles ? "1 view in feed" : "No extra views";
      return;
    }
    const grid = drawer.querySelector(".view-grid");
    grid.innerHTML = images.map((image) => `
      <a href="${escapeHtml(image.link)}" target="_blank" rel="noreferrer" class="view-tile">
        <img src="${escapeHtml(image.link)}" alt="">
        <span>${escapeHtml(image.viewCode || "view")}</span>
      </a>
    `).join("");
    if (status) status.textContent = `${formatNumber(images.length)} views`;
  } catch (error) {
    if (status) status.textContent = currentTiles ? "1 view in feed" : "Views unavailable";
    console.warn("Could not hydrate product images", error);
  }
}

function sameCode(left, right) {
  return String(left ?? "").trim().toLowerCase() === String(right ?? "").trim().toLowerCase();
}

function groupRowsByProductId(rows) {
  const groups = new Map();
  for (const row of rows) {
    const id = row.productGroupId || `${row.pairCode || row.productCode}${row.colorCode || ""}`;
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        pairCode: row.pairCode || row.productCode,
        modelColorCode: row.modelColorCode || row.variantCode,
        colorCode: row.colorCode,
        color: row.color,
        name: row.productName,
        category: productCategory(row.productCode),
        manufacturer: row.manufacturer,
        image: row.image,
        images: row.images || [],
        rows: []
      });
    }
    groups.get(id).rows.push(row);
  }
  for (const group of groups.values()) {
    group.rows.sort(compareSizes);
  }
  return groups;
}

function collectGroupImages(group) {
  const seen = new Set();
  const images = [];
  for (const row of group.rows) {
    for (const image of row.images || []) {
      if (!image.link || seen.has(image.link)) continue;
      seen.add(image.link);
      images.push(image);
    }
  }
  if (!images.length && group.image) images.push({ viewCode: "main", link: group.image });
  return images.slice(0, 8);
}

function compareSizes(a, b) {
  const aKey = sizeSortKey(a);
  const bKey = sizeSortKey(b);
  if (aKey.familyRank !== bKey.familyRank) return aKey.familyRank - bKey.familyRank;
  if (aKey.value !== bKey.value) return aKey.value - bKey.value;
  return String(a.sizeName || a.sizeCode || "").localeCompare(String(b.sizeName || b.sizeCode || ""), undefined, { numeric: true });
}

function sizeSortKey(row) {
  const raw = String(row.sizeName || row.sizeCode || "");
  const sizeCode = String(row.sizeCode || "");
  const normalized = raw.trim().toUpperCase();
  const alphaOrder = {
    XXS: 10,
    XS: 20,
    S: 30,
    M: 40,
    L: 50,
    XL: 60,
    XXL: 70,
    "2XL": 70,
    XXXL: 80,
    "3XL": 80,
    "4XL": 90,
    "5XL": 100
  };
  const alphaMatch = normalized.match(/\b(XXS|XS|XXXL|XXL|[2-5]XL|XL|S|M|L)\b/);
  if (alphaMatch) return { familyRank: 20, value: alphaOrder[alphaMatch[1]] || 999 };
  const ageMatch = normalized.match(/(\d+)\s*(?:CM|YEARS?|Y|ANS?)/);
  if (ageMatch) return { familyRank: 10, value: Number(ageMatch[1]) };
  const numberMatch = normalized.match(/\d+(?:[.,]\d+)?/) || sizeCode.match(/\d+/);
  if (numberMatch) return { familyRank: 30, value: Number(String(numberMatch[0]).replace(",", ".")) };
  return { familyRank: 99, value: 9999 };
}

function sizeRange(rows) {
  const sizes = [...new Set(rows.map((row) => row.sizeName).filter(Boolean))];
  if (sizes.length <= 3) return sizes.join(", ") || "-";
  return `${sizes.slice(0, 3).join(", ")} +${sizes.length - 3}`;
}

function priceRange(values, currency) {
  if (!values.length) return "-";
  const min = Math.min(...values.map(Number));
  const max = Math.max(...values.map(Number));
  if (min === max) return formatMoney(min, currency);
  return `${formatMoney(min, currency)} - ${formatMoney(max, currency)}`;
}

function priceCell(value) {
  const safe = escapeHtml(value).replace(/\s-\s/g, `<span class="price-separator">-</span>`);
  return `<span class="price-cell">${safe}</span>`;
}

function productIdentity(name, productId, color, manufacturer) {
  return `
    <div class="product-identity">
      <div class="name">${escapeHtml(name || "-")}</div>
      <div class="sub">
        <span>${escapeHtml(productId || "-")}</span>
        <span>${escapeHtml(color || "-")}</span>
        <span class="manufacturer-badge">${escapeHtml(manufacturer || "Unknown")}</span>
      </div>
    </div>
  `;
}

function stockPill(current, future) {
  const value = Number(current || 0);
  const futureValue = Number(future || 0);
  const cls = value > 0 ? "green" : "red";
  const futureText = futureValue > 0 ? `<div class="sub">Future ${formatNumber(futureValue)}</div>` : "";
  return `<span class="pill ${cls}">${formatNumber(value)}</span>${futureText}`;
}

function stockBadge(current, future) {
  const value = Number(current || 0);
  const futureValue = Number(future || 0);
  const cls = value > 0 ? "good" : "empty";
  const futureText = futureValue > 0 ? `
    <span class="stock-line upcoming" aria-label="Incoming stock: ${formatNumber(futureValue)}" title="Incoming stock: ${formatNumber(futureValue)}">
      <span aria-hidden="true">↗</span>
      <strong>${formatNumber(futureValue)}</strong>
    </span>
  ` : "";
  return `
    <span class="stock-stack ${futureValue > 0 ? "has-upcoming" : ""}">
      <span class="stock-line current" aria-label="Current warehouse stock: ${formatNumber(value)}" title="Current warehouse stock: ${formatNumber(value)}">
        <span aria-hidden="true">▣</span>
        <strong class="stock-badge ${cls}">${formatNumber(value)}</strong>
      </span>
      ${futureText}
    </span>
  `;
}

function barcodeBadge(missing, total) {
  if (!missing) return `<span class="barcode-badge good">${formatNumber(total)} EAN</span>`;
  return `<span class="barcode-badge bad">${formatNumber(missing)} missing</span>`;
}

function renderChanges() {
  const changes = state.data.changes || {};
  els.changes.innerHTML = noteList([
    ["New sizes", changes.newSizes?.length || 0, "teal"],
    ["Removed sizes", changes.removedSizes?.length || 0, "bad"],
    ["Stock changed", changeCount(changes, "stockChanged"), "warn"],
    ["PA changed", changeCount(changes, "priceChanged"), "warn"]
  ]);
}

function changeCount(changes, key) {
  const explicit = changes?.[`${key}Count`];
  if (explicit !== undefined && explicit !== null) return Number(explicit || 0);
  return changes?.[key]?.length || 0;
}

function renderQuality() {
  const counts = state.data.counts;
  els.quality.innerHTML = noteList([
    ["Missing EAN", counts.missingEan, counts.missingEan ? "warn" : "teal"],
    ["Missing image", counts.missingImage, counts.missingImage ? "warn" : "teal"],
    ["Missing PA", counts.missingPrice, counts.missingPrice ? "bad" : "teal"],
    ["Future stock rows", state.rows.filter((row) => Number(row.futureStock || 0) > 0).length, "teal"]
  ]);
}

function renderQualityDetail() {
  const counts = state.data.counts;
  els.qualityDetail.innerHTML = [
    ["Missing barcode", counts.missingEan],
    ["Missing image", counts.missingImage],
    ["Missing PA", counts.missingPrice],
    ["Missing product type", counts.missingProductType],
    ["Out of stock SKU rows", counts.outOfStock],
    ["Future stock rows", state.rows.filter((row) => Number(row.futureStock || 0) > 0).length],
    ["Quality score", `${counts.qualityScore || 0}%`]
  ].map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${typeof value === "number" ? formatNumber(value) : escapeHtml(value)}</strong></div>`).join("");
}

function renderCharts() {
  const counts = state.data.counts;
  drawDonut("stockStatusChart", [
    { label: "In stock", value: counts.inStock, color: "#0ea5e9" },
    { label: "Out", value: counts.outOfStock, color: "#ef4444" }
  ]);
  drawBars("stockTypeChart", (state.data.categoryStats || []).slice(0, 8).map((row) => ({
    label: row.category,
    value: row.totalStock,
    color: "#7b1f25"
  })));
  drawBars("priceChart", (state.data.priceBuckets || []).map((row) => ({
    label: row.label,
    value: row.count,
    color: "#e0a72e"
  })));
  drawBars("missingChart", [
    { label: "EAN", value: counts.missingEan, color: "#b42318" },
    { label: "Image", value: counts.missingImage, color: "#b42318" },
    { label: "PA", value: counts.missingPrice, color: "#b42318" },
    { label: "Type", value: counts.missingProductType, color: "#b42318" }
  ]);
}

function renderHistory() {
  const history = state.data.importHistory || [];
  const latest = history[history.length - 1] || {};
  const previous = history[history.length - 2] || latest;
  document.querySelector("#deltaProducts").textContent = signed(latest.products - previous.products);
  document.querySelector("#deltaVariants").textContent = signed(latest.sizes - previous.sizes);
  document.querySelector("#deltaStock").textContent = signed(latest.totalStock - previous.totalStock);
  document.querySelector("#deltaQuality").textContent = `${signed(latest.qualityScore - previous.qualityScore)}%`;
  drawLine("historyChart", history.slice(-20).map((row) => ({
    label: new Date(row.importedAt).toLocaleDateString(),
    value: row.totalStock
  })));
  els.historyBody.innerHTML = history.slice(-10).reverse().map((row) => `
    <tr>
      <td>${escapeHtml(new Date(row.importedAt).toLocaleString())}</td>
      <td>${formatNumber(row.products)}</td>
      <td>${formatNumber(row.sizes)}</td>
      <td>${formatNumber(row.totalStock)}</td>
      <td>${formatNumber(row.qualityScore)}%</td>
    </tr>
  `).join("");
  initializePeriodInputs(history);
}

function initializePeriodInputs(history) {
  if (!history.length || (els.periodStart.value && els.periodEnd.value)) return;
  const last = history[history.length - 1]?.importedAt;
  if (last) applyPeriodPreset(els.periodPreset.value || "7d", false);
}

function renderPeriodSections() {
  const comparison = currentPeriodComparison();
  renderPeriodMovement(comparison);
  renderRecentUpdates(comparison);
  renderStockMovers(comparison);
}

function currentPeriodComparison() {
  const snapshots = stockSnapshots();
  if (snapshots.length < 2) {
    return {
      hasComparison: false,
      reason: "Stock period movement needs at least two imports from now.",
      detail: "Run another import to compare stock by SKU over a selected period.",
      movements: []
    };
  }
  const periodStart = els.periodStart.value ? new Date(els.periodStart.value) : new Date(snapshots[0].importedAt);
  const periodEnd = els.periodEnd.value ? new Date(els.periodEnd.value) : new Date(snapshots[snapshots.length - 1].importedAt);
  const inPeriod = snapshots.filter((snapshot) => {
    const importedAt = new Date(snapshot.importedAt);
    return importedAt >= periodStart && importedAt <= periodEnd;
  });
  if (inPeriod.length < 2) {
    return {
      hasComparison: false,
      reason: "Select a period with at least two stock snapshots.",
      detail: "No stock comparison available for this period yet.",
      movements: []
    };
  }
  const before = inPeriod[0];
  const after = inPeriod[inPeriod.length - 1];
  const movements = compareStockSnapshots(before, after);
  const totalDelta = movements.reduce((sum, item) => sum + item.delta, 0);
  return {
    hasComparison: true,
    before,
    after,
    movements,
    totalDelta,
    summary: `${formatNumber(movements.length)} SKUs changed - total stock ${signed(totalDelta)} from ${formatDateTimeShort(before.importedAt)} to ${formatDateTimeShort(after.importedAt)}`
  };
}

function renderPeriodMovement(comparison = currentPeriodComparison()) {
  if (!comparison.hasComparison) {
    els.periodSummary.textContent = comparison.reason;
    els.periodMovementBody.innerHTML = `<div class="movement-empty">${escapeHtml(comparison.detail)}</div>`;
    return;
  }
  const movements = comparison.movements || [];
  els.periodSummary.textContent = comparison.summary;
  const rows = movements
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 12);
  renderMovementCards(els.periodMovementBody, rows, renderPeriodMovementCard);
}

function stockSnapshots() {
  const snapshots = Array.isArray(state.data.stockSnapshots) ? state.data.stockSnapshots : [];
  if (snapshots.length) return snapshots;
  if (!state.data.flatSizes?.length) return [];
  const history = state.data.importHistory || [];
  const previousHistory = history[history.length - 2];
  const stockChanged = state.data.changes?.stockChanged || [];
  if (previousHistory && stockChanged.length) {
    const previousStockByCode = new Map(stockChanged.map(({ before }) => [before.productSizeCode || before.code, Number(before.currentStock || 0)]));
    const previousRows = state.data.flatSizes.map((row) => ({
      code: row.code,
      productSizeCode: row.productSizeCode,
      pairCode: row.pairCode,
      productCode: row.productCode,
      productName: row.productName,
      color: row.color,
      colorCode: row.colorCode,
      sizeName: row.sizeName,
      sizeCode: row.sizeCode,
      currentStock: previousStockByCode.has(row.productSizeCode || row.code)
        ? previousStockByCode.get(row.productSizeCode || row.code)
        : Number(row.currentStock || 0)
    }));
    const currentRows = state.data.flatSizes.map((row) => ({
      code: row.code,
      productSizeCode: row.productSizeCode,
      pairCode: row.pairCode,
      productCode: row.productCode,
      productName: row.productName,
      color: row.color,
      colorCode: row.colorCode,
      sizeName: row.sizeName,
      sizeCode: row.sizeCode,
      currentStock: Number(row.currentStock || 0)
    }));
    return [
      { importedAt: previousHistory.importedAt, rows: previousRows },
      { importedAt: state.data.importedAt, rows: currentRows }
    ];
  }
  return [{
    importedAt: state.data.importedAt,
    rows: state.data.flatSizes.map((row) => ({
      code: row.code,
      productSizeCode: row.productSizeCode,
      pairCode: row.pairCode,
      productCode: row.productCode,
      productName: row.productName,
      color: row.color,
      colorCode: row.colorCode,
      sizeName: row.sizeName,
      sizeCode: row.sizeCode,
      currentStock: Number(row.currentStock || 0)
    }))
  }];
}

function compareStockSnapshots(before, after) {
  const beforeRows = new Map((before.rows || []).map((row) => [snapshotRowKey(row), row]));
  const movements = [];
  for (const afterRow of after.rows || []) {
    const key = snapshotRowKey(afterRow);
    const old = beforeRows.get(key);
    if (!old) continue;
    const beforeStock = snapshotRowStock(old);
    const afterStock = snapshotRowStock(afterRow);
    const delta = afterStock - beforeStock;
    if (!delta) continue;
    movements.push({
      before: hydrateSnapshotRow(old, beforeStock),
      after: hydrateSnapshotRow(afterRow, afterStock),
      delta
    });
  }
  return movements;
}

function snapshotRowKey(row) {
  return row?.k || row?.key || row?.productSizeCode || row?.code || "";
}

function snapshotRowStock(row) {
  return Number(row?.s ?? row?.stock ?? row?.currentStock ?? 0);
}

function hydrateSnapshotRow(row, stock) {
  const key = snapshotRowKey(row);
  const current = currentRowBySnapshotKey().get(key);
  return {
    ...(current || {}),
    ...row,
    code: current?.code || row.code || key,
    productSizeCode: current?.productSizeCode || row.productSizeCode || key,
    currentStock: stock
  };
}

function currentRowBySnapshotKey() {
  if (!state.currentRowBySnapshotKey) {
    state.currentRowBySnapshotKey = new Map((state.rows || []).map((row) => [snapshotRowKey(row), row]));
  }
  return state.currentRowBySnapshotKey;
}

function renderPeriodMovementCard(item) {
  const row = item.after || {};
  return `
    <article class="movement-card">
      <div class="movement-main">
        <span class="movement-kind ${item.delta < 0 ? "seller" : "stock"}">${escapeHtml(item.delta < 0 ? "Down" : "Up")}</span>
        <div>
          <strong>${escapeHtml(row.productName || "-")}</strong>
          <span>${escapeHtml(row.code || row.productSizeCode || "-")} · model ${escapeHtml(row.pairCode || row.productCode || "-")} · ${escapeHtml(row.color || "-")} · ${escapeHtml(row.sizeName || row.sizeCode || "-")}</span>
        </div>
      </div>
      <div class="movement-values">
        <span>${formatNumber(item.before.currentStock)} before</span>
        <strong class="${item.delta < 0 ? "negative" : "positive"}">${signed(item.delta)}</strong>
        <span>${formatNumber(item.after.currentStock)} now</span>
      </div>
    </article>
  `;
}

function dateTimeInputValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function formatDateTimeShort(value) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function applyPeriodPreset(preset, shouldRender = true) {
  const snapshots = stockSnapshots();
  const latest = snapshots[snapshots.length - 1]?.importedAt || state.data?.importedAt || new Date().toISOString();
  const end = new Date(latest);
  const start = new Date(end);
  const ranges = {
    "1h": 1 * 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000
  };
  if (preset !== "custom") {
    start.setTime(end.getTime() - (ranges[preset] || ranges["7d"]));
    els.periodStart.value = dateTimeInputValue(start);
    els.periodEnd.value = dateTimeInputValue(end);
  }
  if (shouldRender) renderPeriodSections();
}

function renderRecentUpdates(comparison = currentPeriodComparison()) {
  if (!comparison.hasComparison) {
    els.recentUpdatesBody.innerHTML = `<div class="movement-empty">${escapeHtml(comparison.detail)}</div>`;
    return;
  }
  const stockRows = (comparison.movements || []).map(({ before, after, delta }) => ({
    type: "Stock",
    row: after,
    delta,
    change: signed(delta),
    now: `${formatNumber(after.currentStock)} units`,
    before: `${formatNumber(before.currentStock)} units`
  }));
  const rows = stockRows
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 8);
  renderMovementCards(els.recentUpdatesBody, rows, renderRecentUpdateCard);
}

function renderNewProducts() {
  const rows = (state.data.changes?.newSizes || []).slice(0, 10);
  renderSimpleRows(els.newProductsBody, rows, 4, (row) => `
    <td>${escapeHtml(row.code || row.productSizeCode)}</td>
    <td>${escapeHtml(row.pairCode || row.productCode)}</td>
    <td>${escapeHtml(row.productName)}</td>
    <td>${formatNumber(row.currentStock)}</td>
  `);
}

function renderStockMovers(comparison = currentPeriodComparison()) {
  if (!comparison.hasComparison) {
    els.stockMoversBody.innerHTML = `<div class="movement-empty">${escapeHtml(comparison.detail)}</div>`;
    return;
  }
  const rows = (comparison.movements || [])
    .filter((row) => row.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 8);
  renderMovementCards(els.stockMoversBody, rows, renderStockMoverCard);
}

function renderMovementCards(target, rows, template) {
  if (!rows.length) {
    target.innerHTML = `<div class="movement-empty">No movement in the current snapshot.</div>`;
    return;
  }
  target.innerHTML = rows.map(template).join("");
}

function renderRecentUpdateCard(item) {
  const row = item.row || {};
  return `
    <article class="movement-card">
      <div class="movement-main">
        <span class="movement-kind ${item.type === "PA" ? "price" : "stock"}">${escapeHtml(item.type)}</span>
        <div>
          <strong>${escapeHtml(row.productName || "-")}</strong>
          <span>${escapeHtml(row.code || row.productSizeCode || "-")} · model ${escapeHtml(row.pairCode || row.productCode || "-")} · ${escapeHtml(row.sizeName || row.sizeCode || "-")}</span>
        </div>
      </div>
      <div class="movement-values">
        <span>${escapeHtml(item.before)}</span>
        <strong class="${item.delta < 0 ? "negative" : "positive"}">${escapeHtml(item.change)}</strong>
        <span>${escapeHtml(item.now)}</span>
      </div>
    </article>
  `;
}

function renderStockMoverCard(item) {
  const row = item.after || {};
  const sold = Math.abs(item.delta);
  return `
    <article class="movement-card seller-card">
      <div class="movement-main">
        <span class="movement-kind seller">${formatNumber(sold)}</span>
        <div>
          <strong>${escapeHtml(row.productName || "-")}</strong>
          <span>${escapeHtml(row.code || row.productSizeCode || "-")} · model ${escapeHtml(row.pairCode || row.productCode || "-")} · ${escapeHtml(row.color || "-")} · ${escapeHtml(row.sizeName || row.sizeCode || "-")}</span>
        </div>
      </div>
      <div class="movement-values">
        <span>${formatNumber(item.before.currentStock)} before</span>
        <strong class="negative">${signed(item.delta)}</strong>
        <span>${formatNumber(item.after.currentStock)} now</span>
      </div>
    </article>
  `;
}

function renderProductTypes() {
  const rows = (state.data.categoryStats || []).slice(0, 12);
  renderSimpleRows(els.productTypesBody, rows, 4, (row) => `
    <td>${escapeHtml(row.category)}</td>
    <td>${formatNumber(row.variants)}</td>
    <td>${formatNumber(row.totalStock)}</td>
    <td>${escapeHtml(formatMoney(row.averageRecommendedPrice, row.currency || "EUR"))}</td>
  `);
}

function renderSimpleRows(target, rows, colspan, template) {
  if (!rows.length) {
    target.innerHTML = `<tr><td colspan="${colspan}" class="muted">No movement in the current snapshot.</td></tr>`;
    return;
  }
  target.innerHTML = rows.map((row) => `<tr>${template(row)}</tr>`).join("");
}

function signed(value) {
  const numeric = Number(value || 0);
  return `${numeric > 0 ? "+" : ""}${formatNumber(numeric)}`;
}

function signedMoney(value, currency) {
  const numeric = Number(value || 0);
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(2)} ${currency || ""}`.trim();
}

function drawBars(id, rows) {
  const canvas = document.querySelector(`#${id}`);
  if (!canvas) return;
  const ctx = setupCanvas(canvas);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  const max = Math.max(1, ...rows.map((row) => Number(row.value || 0)));
  const gap = 10;
  const barHeight = Math.max(14, (height - 28 - gap * rows.length) / Math.max(1, rows.length));
  ctx.font = "12px system-ui, sans-serif";
  rows.forEach((row, index) => {
    const y = 18 + index * (barHeight + gap);
    const labelWidth = 110;
    const barWidth = Math.max(2, (width - labelWidth - 70) * (Number(row.value || 0) / max));
    ctx.fillStyle = cssVar("--muted");
    ctx.fillText(String(row.label).slice(0, 16), 0, y + barHeight - 2);
    ctx.fillStyle = row.color;
    roundRect(ctx, labelWidth, y, barWidth, barHeight, 7);
    ctx.fill();
    ctx.fillStyle = cssVar("--ink");
    ctx.fillText(formatNumber(row.value), labelWidth + barWidth + 8, y + barHeight - 2);
  });
}

function drawDonut(id, rows) {
  const canvas = document.querySelector(`#${id}`);
  if (!canvas) return;
  const ctx = setupCanvas(canvas);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  const total = Math.max(1, rows.reduce((sum, row) => sum + Number(row.value || 0), 0));
  const cx = width / 2;
  const cy = height / 2 - 8;
  const radius = Math.min(width, height) * .32;
  let start = -Math.PI / 2;
  for (const row of rows) {
    const angle = (Number(row.value || 0) / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = row.color;
    ctx.fill();
    start += angle;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, radius * .58, 0, Math.PI * 2);
  ctx.fillStyle = cssVar("--surface");
  ctx.fill();
  ctx.fillStyle = cssVar("--ink");
  ctx.font = "700 22px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${Math.round((rows[0].value / total) * 100)}%`, cx, cy + 7);
  ctx.textAlign = "left";
  ctx.font = "12px system-ui, sans-serif";
  rows.forEach((row, index) => {
    const x = 18 + index * 150;
    const y = height - 24;
    ctx.fillStyle = row.color;
    roundRect(ctx, x, y - 10, 10, 10, 5);
    ctx.fill();
    ctx.fillStyle = cssVar("--muted");
    ctx.fillText(`${row.label} ${formatNumber(row.value)}`, x + 16, y);
  });
}

function drawLine(id, rows) {
  const canvas = document.querySelector(`#${id}`);
  if (!canvas) return;
  const ctx = setupCanvas(canvas);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  if (!rows.length) return;
  const values = rows.map((row) => Number(row.value || 0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const points = rows.map((row, index) => ({
    x: 24 + index * ((width - 48) / Math.max(1, rows.length - 1)),
    y: height - 28 - ((Number(row.value || 0) - min) / range) * (height - 60)
  }));
  ctx.strokeStyle = cssVar("--border");
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const y = 20 + i * ((height - 48) / 3);
    ctx.beginPath();
    ctx.moveTo(20, y);
    ctx.lineTo(width - 20, y);
    ctx.stroke();
  }
  ctx.strokeStyle = cssVar("--primary");
  ctx.lineWidth = 3;
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.stroke();
  ctx.fillStyle = cssVar("--accent");
  points.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

function setupCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 400;
  const height = canvas.clientHeight || 260;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function noteList(items) {
  return `<div class="note-list">${items.map(([label, value, tone]) => `
    <div class="note ${tone === "bad" ? "bad" : tone === "warn" ? "warn" : ""}">
      <span>${escapeHtml(label)}</span>
      <strong>${formatNumber(value)}</strong>
    </div>
  `).join("")}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function exportFilteredCsv() {
  exportRowsCsv(sortRows(filteredRows()), "malfini-filtered-feed");
}

function exportFullCsv() {
  exportRowsCsv(sortRows(state.rows || []), "malfini-full-feed");
}

function exportRowsCsv(rows, filenameBase) {
  const headers = [
    "sku",
    "productId",
    "pairCode",
    "productName",
    "manufacturer",
    "category",
    "color",
    "size",
    "ean",
    "stock",
    "futureStock",
    "pa",
    "paCurrency",
    "msrp",
    "msrpCurrency",
    "image"
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) => [
      row.code || row.productSizeCode || "",
      row.productGroupId || "",
      row.pairCode || row.productCode || "",
      row.productName || "",
      row.manufacturer || "",
      productCategory(row.productCode) || "",
      row.color || "",
      row.sizeName || row.sizeCode || "",
      row.ean || "",
      row.currentStock ?? "",
      row.futureStock ?? "",
      row.wholesalePrice ?? "",
      row.wholesaleCurrency || "",
      row.recommendedPrice ?? "",
      row.recommendedCurrency || "",
      row.image || ""
    ].map(csvCell).join(","))
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `${filenameBase}-${date}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

els.refreshBtn.addEventListener("click", () => loadDashboard(true));
els.reloadBtn.addEventListener("click", () => loadDashboard(false));
els.fullExportBtn.addEventListener("click", exportFullCsv);
els.themeToggle.addEventListener("click", () => {
  toggleTheme();
});

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("malfini-theme", next);
  els.themeToggle.textContent = next === "dark" ? "Light mode" : "Dark mode";
  if (state.data) renderCharts();
}
let headerScrollTicking = false;
function syncHeaderScrollState() {
  document.body.classList.toggle("dashboard-scrolled", window.scrollY > 32);
  headerScrollTicking = false;
}

function requestHeaderScrollState() {
  if (headerScrollTicking) return;
  headerScrollTicking = true;
  requestAnimationFrame(syncHeaderScrollState);
}

window.addEventListener("scroll", requestHeaderScrollState, { passive: true });
document.addEventListener("scroll", requestHeaderScrollState, { passive: true });
document.querySelector(".hero")?.addEventListener("wheel", (event) => {
  if (event.ctrlKey) return;
  event.preventDefault();
  window.scrollBy({ top: event.deltaY, left: event.deltaX, behavior: "auto" });
  requestHeaderScrollState();
}, { passive: false });
syncHeaderScrollState();
els.searchInput.addEventListener("input", renderRows);
els.categoryFilter.addEventListener("change", renderRows);
els.manufacturerFilter.addEventListener("change", renderRows);
els.stockFilter.addEventListener("change", renderRows);
els.eanFilter.addEventListener("change", renderRows);
els.pageSizeSelect.addEventListener("change", renderRows);
els.groupProductsToggle.addEventListener("change", renderRows);
els.activeFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter-key]");
  if (!button) return;
  clearFilter(button.dataset.filterKey);
});
els.clearFiltersBtn.addEventListener("click", clearCatalogFilters);
els.exportFilteredBtn.addEventListener("click", exportFilteredCsv);
document.querySelector(".catalog-table thead")?.addEventListener("click", (event) => {
  const button = event.target.closest(".sort-button");
  if (!button) return;
  setSort(button.dataset.sortKey);
});
els.applyPeriodBtn.addEventListener("click", renderPeriodSections);
els.periodPreset.addEventListener("change", () => applyPeriodPreset(els.periodPreset.value));
els.periodStart.addEventListener("change", () => {
  els.periodPreset.value = "custom";
  renderPeriodSections();
});
els.periodEnd.addEventListener("change", () => {
  els.periodPreset.value = "custom";
  renderPeriodSections();
});
els.productRows.addEventListener("click", (event) => {
  const button = event.target.closest(".show-button");
  if (!button) return;
  const id = button.dataset.groupId;
  if (state.expandedGroups.has(id)) state.expandedGroups.delete(id);
  else state.expandedGroups.add(id);
  renderRows();
});
window.addEventListener("resize", () => {
  if (state.data) renderCharts();
});

loadDashboard(false);

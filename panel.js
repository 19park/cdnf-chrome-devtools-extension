const domainEl = document.getElementById("domain");
const countEl = document.getElementById("count");
const clearBtn = document.getElementById("clearBtn");
const filterBar = document.getElementById("filterBar");
const listPane = document.getElementById("listPane");
const tbody = document.getElementById("tbody");
const emptyMsg = document.getElementById("emptyMsg");
const detailPane = document.getElementById("detailPane");
const detailTabs = document.getElementById("detailTabs");
const detailBody = document.getElementById("detailBody");
const detailClose = document.getElementById("detailClose");

let currentHostname = "";
let entries = []; // { entry, tr, category, pending }
let selectedRow = null;
let selectedEntry = null;
let activeTab = "headers";
let activeFilter = "all";
let autoScroll = true;
let isLoadingExisting = false;
let scrollRafId = null;

// Pending request tracking
const pendingById = new Map();   // requestId -> entries[] index
const urlQueue = new Map();      // url -> [requestId, ...]
const cacheInfo = new Map();     // requestId -> { fromCache }

// --- Background port connection ---

const port = chrome.runtime.connect({ name: "net-filter" });
port.postMessage({ type: "init", tabId: chrome.devtools.inspectedWindow.tabId });

port.onMessage.addListener((msg) => {
  if (msg.type === "start") {
    onRequestStart(msg);
  } else if (msg.type === "end") {
    onRequestEnd(msg);
  } else if (msg.type === "error") {
    onRequestError(msg);
  }
});

// --- Hostname detection ---

function detectHostname(cb, retries) {
  if (retries === undefined) retries = 5;
  chrome.devtools.inspectedWindow.eval("location.hostname", (hostname, err) => {
    if (err || !hostname) {
      if (retries > 0) {
        setTimeout(() => detectHostname(cb, retries - 1), 300);
        return;
      }
      currentHostname = "";
      domainEl.textContent = "(unknown)";
    } else {
      currentHostname = hostname;
      domainEl.textContent = hostname;
    }
    if (cb) cb();
  });
}

// --- Helpers ---

function getHostname(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function matchesDomain(url) {
  return currentHostname && getHostname(url) === currentHostname;
}

function formatSize(bytes) {
  if (bytes <= 0) return "\u2014";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " kB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatSizeWithCache(entry) {
  const res = entry.response;
  const transferSize = entry._transferSize;
  const contentSize = res.content ? res.content.size : 0;
  const status = res.status;

  if (typeof transferSize === "number" && transferSize === 0 && status === 200 && contentSize > 0) {
    if (entry.time < 10) {
      return '<span class="size-cache">(memory)</span>';
    }
    return '<span class="size-cache">(disk)</span>';
  }

  if (typeof transferSize === "number" && transferSize > 0) {
    return formatSize(transferSize);
  }

  return formatSize(contentSize || res.bodySize);
}

function formatTime(ms) {
  if (ms <= 0) return "\u2014";
  if (ms < 1000) return Math.round(ms) + " ms";
  return (ms / 1000).toFixed(2) + " s";
}

function shortType(mimeType) {
  if (!mimeType) return "";
  const map = {
    "application/json": "json",
    "application/javascript": "js",
    "text/javascript": "js",
    "text/html": "html",
    "text/css": "css",
    "text/plain": "text",
    "application/xml": "xml",
    "text/xml": "xml",
    "image/png": "png",
    "image/jpeg": "jpeg",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "image/webp": "webp",
    "font/woff2": "woff2",
    "font/woff": "woff",
    "application/wasm": "wasm",
  };
  return map[mimeType] || mimeType.replace(/^(application|text)\//, "");
}

function getPathname(url) {
  try {
    const u = new URL(url);
    return u.pathname || "/";
  } catch {
    return url;
  }
}

function renderPathname(url) {
  const path = getPathname(url);
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash < 0 || lastSlash === path.length - 1) {
    return esc(path);
  }
  const dir = path.substring(0, lastSlash + 1);
  const name = path.substring(lastSlash + 1);
  return esc(dir) + '<span class="path-name">' + esc(name) + '</span>';
}

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// --- Resource type categorization ---

function categorize(entry) {
  const rt = entry._resourceType;
  if (rt) {
    const t = rt.toLowerCase();
    if (t === "xhr" || t === "fetch") return "fetch";
    if (t === "document") return "doc";
    if (t === "stylesheet") return "css";
    if (t === "script") return "js";
    if (t === "image") return "img";
    if (t === "media") return "media";
    if (t === "font") return "font";
    if (t === "websocket") return "ws";
    return "other";
  }

  const mime = (entry.response && entry.response.content)
    ? entry.response.content.mimeType || "" : "";
  const m = mime.toLowerCase();

  if (m.includes("json") || m.includes("xml") || m === "text/plain") return "fetch";
  if (m.includes("html")) return "doc";
  if (m.includes("css")) return "css";
  if (m.includes("javascript")) return "js";
  if (m.startsWith("image/")) return "img";
  if (m.startsWith("video/") || m.startsWith("audio/")) return "media";
  if (m.startsWith("font/") || m.includes("woff") || m.includes("opentype")) return "font";
  return "other";
}

function categorizeWebRequestType(type) {
  switch (type) {
    case "xmlhttprequest": return "fetch";
    case "main_frame":
    case "sub_frame": return "doc";
    case "stylesheet": return "css";
    case "script": return "js";
    case "image": return "img";
    case "media": return "media";
    case "font": return "font";
    case "websocket": return "ws";
    default: return "other";
  }
}

function isFilterVisible(url, category) {
  if (activeFilter === "all") return true;
  if (activeFilter === "api") return getPathname(url).startsWith("/api");
  return category === activeFilter;
}

// --- Auto-scroll ---

listPane.addEventListener("wheel", (e) => {
  if (e.deltaY < 0) {
    autoScroll = false;
  } else {
    requestAnimationFrame(() => {
      const gap = listPane.scrollHeight - listPane.scrollTop - listPane.clientHeight;
      if (gap < 40) autoScroll = true;
    });
  }
});

listPane.addEventListener("mousedown", () => {
  const onUp = () => {
    const gap = listPane.scrollHeight - listPane.scrollTop - listPane.clientHeight;
    autoScroll = gap < 40;
    document.removeEventListener("mouseup", onUp);
  };
  document.addEventListener("mouseup", onUp);
});

function scheduleScrollToBottom() {
  if (scrollRafId) return;
  scrollRafId = requestAnimationFrame(() => {
    listPane.scrollTop = listPane.scrollHeight;
    scrollRafId = null;
  });
}

// --- Pending requests (from webRequest) ---

function onRequestStart(msg) {
  const url = msg.url;
  if (!matchesDomain(url)) return;

  const idx = entries.length;
  const cat = categorizeWebRequestType(msg.resourceType);

  const tr = document.createElement("tr");
  tr.title = url;
  tr.dataset.idx = idx;
  tr.dataset.cat = cat;
  tr.classList.add("pending");

  tr.innerHTML =
    `<td class="col-method">${esc(msg.method)}</td>` +
    `<td class="col-status status-pending">Pending</td>` +
    `<td class="col-name">${renderPathname(url)}</td>` +
    `<td class="col-type">${esc(cat)}</td>` +
    `<td class="col-size">\u2014</td>` +
    `<td class="col-time">\u2014</td>`;

  tr.addEventListener("click", () => selectRow(tr, idx));

  if (!isFilterVisible(url, cat)) {
    tr.classList.add("hidden");
  }

  entries.push({ entry: null, tr, category: cat, pending: true, url });
  pendingById.set(msg.requestId, idx);

  // URL queue for matching with onRequestFinished
  if (!urlQueue.has(url)) urlQueue.set(url, []);
  urlQueue.get(url).push(msg.requestId);

  tbody.appendChild(tr);
  emptyMsg.style.display = "none";
  updateCount();

  if (!isLoadingExisting && autoScroll) {
    scheduleScrollToBottom();
  }
}

function onRequestEnd(msg) {
  cacheInfo.set(msg.requestId, { fromCache: msg.fromCache, statusCode: msg.statusCode });
}

function onRequestError(msg) {
  const idx = pendingById.get(msg.requestId);
  if (idx === undefined) return;

  const rec = entries[idx];
  if (!rec || !rec.pending) return;

  rec.pending = false;
  rec.tr.classList.remove("pending");
  const statusCell = rec.tr.querySelector(".col-status");
  if (statusCell) {
    statusCell.textContent = "(failed)";
    statusCell.className = "col-status status-err";
  }

  pendingById.delete(msg.requestId);
  const q = urlQueue.get(rec.url);
  if (q) {
    const i = q.indexOf(msg.requestId);
    if (i !== -1) q.splice(i, 1);
    if (q.length === 0) urlQueue.delete(rec.url);
  }
}

// --- Completed requests (from devtools.network) ---

function addRow(entry) {
  const req = entry.request;
  const res = entry.response;
  const url = req.url;

  if (!matchesDomain(url)) return;

  // Try to match a pending row
  const q = urlQueue.get(url);
  if (q && q.length > 0) {
    const requestId = q.shift();
    if (q.length === 0) urlQueue.delete(url);

    const idx = pendingById.get(requestId);
    pendingById.delete(requestId);

    if (idx !== undefined && entries[idx] && entries[idx].pending) {
      // Update existing pending row
      updatePendingRow(idx, entry, requestId);
      return;
    }
  }

  // No pending match — add new completed row
  addCompletedRow(entry);
}

function updatePendingRow(idx, entry, requestId) {
  const rec = entries[idx];
  const req = entry.request;
  const res = entry.response;
  const url = req.url;
  const tr = rec.tr;
  const cat = categorize(entry);

  rec.entry = entry;
  rec.category = cat;
  rec.pending = false;
  tr.classList.remove("pending");
  tr.dataset.cat = cat;

  const status = res.status;
  let statusClass = "";
  if (status >= 400) statusClass = "status-err";
  else if (status >= 300) statusClass = "status-redirect";

  const cached = cacheInfo.get(requestId);
  const sizeHtml = (cached && cached.fromCache)
    ? formatSizeFromCache(entry)
    : formatSizeWithCache(entry);
  cacheInfo.delete(requestId);

  tr.innerHTML =
    `<td class="col-method">${esc(req.method)}</td>` +
    `<td class="col-status ${statusClass}">${status || "\u2014"}</td>` +
    `<td class="col-name">${renderPathname(url)}</td>` +
    `<td class="col-type">${esc(shortType(res.content ? res.content.mimeType : ""))}</td>` +
    `<td class="col-size">${sizeHtml}</td>` +
    `<td class="col-time">${formatTime(entry.time)}</td>`;

  tr.addEventListener("click", () => selectRow(tr, idx));

  // Update filter visibility
  tr.classList.toggle("hidden", !isFilterVisible(url, cat));
  updateCount();

  if (!isLoadingExisting) {
    tr.classList.add("new-row");
    tr.addEventListener("animationend", () => tr.classList.remove("new-row"), { once: true });
  }
}

function addCompletedRow(entry) {
  const req = entry.request;
  const res = entry.response;
  const url = req.url;
  const idx = entries.length;
  const cat = categorize(entry);

  const tr = document.createElement("tr");
  tr.title = url;
  tr.dataset.idx = idx;
  tr.dataset.cat = cat;

  const status = res.status;
  let statusClass = "";
  if (status >= 400) statusClass = "status-err";
  else if (status >= 300) statusClass = "status-redirect";

  tr.innerHTML =
    `<td class="col-method">${esc(req.method)}</td>` +
    `<td class="col-status ${statusClass}">${status || "\u2014"}</td>` +
    `<td class="col-name">${renderPathname(url)}</td>` +
    `<td class="col-type">${esc(shortType(res.content ? res.content.mimeType : ""))}</td>` +
    `<td class="col-size">${formatSizeWithCache(entry)}</td>` +
    `<td class="col-time">${formatTime(entry.time)}</td>`;

  tr.addEventListener("click", () => selectRow(tr, idx));

  if (!isFilterVisible(url, cat)) {
    tr.classList.add("hidden");
  }

  entries.push({ entry, tr, category: cat, pending: false, url });
  tbody.appendChild(tr);
  emptyMsg.style.display = "none";
  updateCount();

  if (!isLoadingExisting) {
    tr.classList.add("new-row");
    tr.addEventListener("animationend", () => tr.classList.remove("new-row"), { once: true });
    if (autoScroll) {
      scheduleScrollToBottom();
    }
  }
}

function formatSizeFromCache(entry) {
  // webRequest confirmed fromCache, use HAR time for memory vs disk
  if (entry.time < 10) {
    return '<span class="size-cache">(memory cache)</span>';
  }
  return '<span class="size-cache">(disk cache)</span>';
}

// --- Count & Clear ---

function updateCount() {
  const visible = entries.filter((e) => !e.tr.classList.contains("hidden")).length;
  const total = entries.length;
  if (activeFilter === "all") {
    countEl.textContent = total + " request" + (total !== 1 ? "s" : "");
  } else {
    countEl.textContent = visible + " / " + total + " requests";
  }
}

function clearRequests() {
  tbody.innerHTML = "";
  entries = [];
  pendingById.clear();
  urlQueue.clear();
  cacheInfo.clear();
  updateCount();
  emptyMsg.style.display = "";
  closeDetail();
  autoScroll = true;
}

// --- Filter bar ---

function applyFilter(filter) {
  activeFilter = filter;

  filterBar.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === filter);
  });

  entries.forEach(({ entry, tr, category, url }) => {
    const reqUrl = entry ? entry.request.url : url;
    tr.classList.toggle("hidden", !isFilterVisible(reqUrl, category));
  });

  updateCount();
}

filterBar.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-btn");
  if (btn && btn.dataset.filter) {
    applyFilter(btn.dataset.filter);
  }
});

// --- Detail pane ---

function selectRow(tr, idx) {
  const rec = entries[idx];
  if (!rec || rec.pending) return; // can't inspect pending

  if (selectedRow) selectedRow.classList.remove("selected");
  selectedRow = tr;
  selectedRow.classList.add("selected");
  selectedEntry = rec.entry;
  detailPane.classList.add("open");
  renderDetail();
}

function closeDetail() {
  detailPane.classList.remove("open");
  if (selectedRow) selectedRow.classList.remove("selected");
  selectedRow = null;
  selectedEntry = null;
  detailBody.innerHTML = "";
}

function setActiveTab(tabName) {
  activeTab = tabName;
  detailTabs.querySelectorAll(".detail-tab").forEach((el) => {
    el.classList.toggle("active", el.dataset.tab === tabName);
  });
  renderDetail();
}

function renderDetail() {
  if (!selectedEntry) return;

  switch (activeTab) {
    case "headers":  renderHeaders();  break;
    case "payload":  renderPayload();  break;
    case "preview":  renderPreview();  break;
    case "response": renderResponse(); break;
  }
}

// --- Headers tab ---

function renderHeaders() {
  const entry = selectedEntry;
  const req = entry.request;
  const res = entry.response;

  let html = "";

  html += section("General", [
    ["Request URL", `<span class="general-url">${esc(req.url)}</span>`],
    ["Request Method", esc(req.method)],
    ["Status Code", esc(res.status + " " + res.statusText)],
  ]);

  html += headerSection("Response Headers", res.headers);
  html += headerSection("Request Headers", req.headers);

  detailBody.innerHTML = html;
}

function section(title, rows) {
  let html = `<div class="header-section">`;
  html += `<div class="header-section-title">${esc(title)}</div>`;
  html += `<table class="header-table">`;
  for (const [name, value] of rows) {
    html += `<tr><td class="h-name">${esc(name)}:</td><td class="h-val">${value}</td></tr>`;
  }
  html += `</table></div>`;
  return html;
}

function headerSection(title, headers) {
  if (!headers || !headers.length) return "";
  let html = `<div class="header-section">`;
  html += `<div class="header-section-title">${esc(title)}</div>`;
  html += `<table class="header-table">`;
  for (const h of headers) {
    html += `<tr><td class="h-name">${esc(h.name)}:</td><td class="h-val">${esc(h.value)}</td></tr>`;
  }
  html += `</table></div>`;
  return html;
}

// --- Payload tab ---

function renderPayload() {
  const req = selectedEntry.request;
  const postData = req.postData;
  const qs = req.queryString;
  const hasPostData = postData && (postData.text || (postData.params && postData.params.length));
  const hasQS = qs && qs.length;

  if (!hasPostData && !hasQS) {
    detailBody.innerHTML = `<div style="color:#888">No payload for this request.</div>`;
    return;
  }

  let html = "";

  if (hasQS) {
    html += `<div class="header-section">`;
    html += `<div class="header-section-title">Query String Parameters</div>`;
    html += `<table class="header-table">`;
    for (const q of qs) {
      html += `<tr><td class="h-name">${esc(q.name)}:</td><td class="h-val">${esc(q.value)}</td></tr>`;
    }
    html += `</table></div>`;
  }

  if (postData && postData.params && postData.params.length) {
    html += `<div class="header-section">`;
    html += `<div class="header-section-title">Form Data</div>`;
    html += `<table class="header-table">`;
    for (const p of postData.params) {
      html += `<tr><td class="h-name">${esc(p.name)}:</td><td class="h-val">${esc(p.value || "")}</td></tr>`;
    }
    html += `</table></div>`;
  }

  if (postData && postData.text) {
    html += `<div class="header-section">`;
    html += `<div class="header-section-title">Request Body</div>`;
    html += `<div class="payload-raw">${esc(tryFormatJSON(postData.text))}</div>`;
    html += `</div>`;
  }

  detailBody.innerHTML = html;
}

// --- Preview tab ---

function renderPreview() {
  const entry = selectedEntry;
  detailBody.innerHTML = `<div style="color:#888">Loading\u2026</div>`;

  getResponseBody(entry, (body, encoding) => {
    const mime = entry.response.content ? entry.response.content.mimeType : "";

    if (mime.includes("json")) {
      try {
        const parsed = JSON.parse(body);
        detailBody.innerHTML = "";
        const tree = document.createElement("div");
        tree.className = "json-tree";
        tree.appendChild(buildJsonNode(parsed, null, true));
        detailBody.appendChild(tree);
      } catch {
        detailBody.innerHTML = `<div class="preview-frame">${esc(body)}</div>`;
      }
    } else if (mime.includes("html")) {
      detailBody.innerHTML = `<div class="preview-frame">${esc(body)}</div>`;
    } else if (mime.startsWith("image/")) {
      const src = encoding === "base64"
        ? `data:${mime};base64,${body}`
        : `data:${mime};base64,${btoa(body)}`;
      detailBody.innerHTML = `<img src="${src}" style="max-width:100%" />`;
    } else {
      detailBody.innerHTML = `<div class="preview-frame">${esc(body || "(empty)")}</div>`;
    }
  });
}

// --- JSON tree builder ---

function buildJsonNode(value, key, expanded) {
  const row = document.createElement("div");
  row.className = "jt-row";

  if (value !== null && typeof value === "object") {
    const isArray = Array.isArray(value);
    const count = isArray ? value.length : Object.keys(value).length;
    const open = isArray ? "[" : "{";
    const close = isArray ? "]" : "}";

    const toggle = document.createElement("span");
    toggle.className = "jt-toggle";
    toggle.textContent = expanded ? "\u25BC" : "\u25B6";
    row.appendChild(toggle);

    if (key !== null) appendKeyColon(row, key);

    const braceOpen = document.createElement("span");
    braceOpen.className = "jt-brace";
    braceOpen.textContent = open;
    row.appendChild(braceOpen);

    const children = document.createElement("div");
    children.className = "jt-children" + (expanded ? "" : " collapsed");

    const kvs = isArray ? value.map((v, i) => [i, v]) : Object.entries(value);
    kvs.forEach(([k, v], i) => {
      const child = buildJsonNode(v, isArray ? null : k, false);
      if (i < count - 1) child.appendChild(document.createTextNode(","));
      children.appendChild(child);
    });

    row.appendChild(children);

    const ellipsis = document.createElement("span");
    ellipsis.className = "jt-ellipsis jt-summary";
    ellipsis.textContent = count === 0 ? "" : (isArray ? `\u2026${count} items` : `\u2026${count} keys`);
    row.appendChild(ellipsis);

    const braceClose = document.createElement("span");
    braceClose.className = "jt-brace";
    braceClose.textContent = close;
    row.appendChild(braceClose);

    toggle.addEventListener("click", () => {
      const collapsed = children.classList.toggle("collapsed");
      toggle.textContent = collapsed ? "\u25B6" : "\u25BC";
    });
    ellipsis.addEventListener("click", () => {
      children.classList.remove("collapsed");
      toggle.textContent = "\u25BC";
    });
  } else {
    const spacer = document.createElement("span");
    spacer.className = "jt-toggle";
    spacer.textContent = " ";
    row.appendChild(spacer);

    if (key !== null) appendKeyColon(row, key);

    const span = document.createElement("span");
    if (value === null) { span.className = "jt-null"; span.textContent = "null"; }
    else if (typeof value === "string") { span.className = "jt-str"; span.textContent = JSON.stringify(value); }
    else if (typeof value === "number") { span.className = "jt-num"; span.textContent = String(value); }
    else if (typeof value === "boolean") { span.className = "jt-bool"; span.textContent = String(value); }
    else { span.textContent = String(value); }
    row.appendChild(span);
  }

  return row;
}

function appendKeyColon(parent, key) {
  const keySpan = document.createElement("span");
  keySpan.className = "jt-key";
  keySpan.textContent = JSON.stringify(String(key));
  parent.appendChild(keySpan);
  const colon = document.createElement("span");
  colon.className = "jt-colon";
  colon.textContent = ": ";
  parent.appendChild(colon);
}

// --- Response tab ---

function renderResponse() {
  const entry = selectedEntry;
  detailBody.innerHTML = `<div style="color:#888">Loading\u2026</div>`;

  getResponseBody(entry, (body) => {
    detailBody.innerHTML = `<div class="response-raw">${esc(body || "(empty)")}</div>`;
  });
}

// --- Response body helper ---

function getResponseBody(entry, cb) {
  if (typeof entry.getContent === "function") {
    entry.getContent((body, encoding) => { cb(body || "", encoding); });
  } else {
    const text = entry.response && entry.response.content ? entry.response.content.text : "";
    cb(text || "", "");
  }
}

function tryFormatJSON(str) {
  try { return JSON.stringify(JSON.parse(str), null, 2); } catch { return str; }
}

// --- Event listeners ---

detailClose.addEventListener("click", closeDetail);

detailTabs.addEventListener("click", (e) => {
  const tab = e.target.closest(".detail-tab");
  if (tab && tab.dataset.tab) setActiveTab(tab.dataset.tab);
});

clearBtn.addEventListener("click", clearRequests);

chrome.devtools.network.onRequestFinished.addListener(addRow);

chrome.devtools.network.onNavigated.addListener(() => {
  clearRequests();
  detectHostname(() => {
    loadExistingRequests();
  });
});

// --- Init ---

function loadExistingRequests() {
  isLoadingExisting = true;
  chrome.devtools.network.getHAR((harLog) => {
    if (harLog && harLog.entries) {
      harLog.entries.forEach(addRow);
    }
    isLoadingExisting = false;
    listPane.scrollTop = listPane.scrollHeight;
  });
}

detectHostname(() => {
  loadExistingRequests();
});

/* Albion Market App (static, no installs)
 * Data source: Albion Online Data Project (west/east/europe hosts)
 * - Market prices:  /api/v2/stats/prices/{item}.json?locations={city}&qualities={q}
 * - Market history: /api/v2/stats/history/{item}.json?locations={city}&qualities={q}&time-scale={hours}
 */

const $ = (id) => document.getElementById(id);

// ---------- Theme ----------
function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
}
function getTheme() {
  return localStorage.getItem("theme") || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
}

// ---------- Helpers ----------
function baseUrl(region) {
  const r = String(region || "west").toLowerCase();
  if (r === "east") return "https://east.albion-online-data.com";
  if (r === "europe") return "https://europe.albion-online-data.com";
  return "https://west.albion-online-data.com";
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}\n${t.slice(0, 250)}`);
  }
  return await res.json();
}

function fmt(n) {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString();
}

function dt(s) {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return String(s).replace("T", " ").replace("Z", "");
    return d.toLocaleString();
  } catch {
    return String(s);
  }
}

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

function toastOK(msg) {
  $("ok").style.display = "block";
  $("ok").textContent = msg;
  setTimeout(() => { $("ok").style.display = "none"; }, 2500);
}

function showErr(msg) {
  $("err").style.display = "block";
  $("err").textContent = msg;
}

function clearErr() {
  $("err").style.display = "none";
  $("err").textContent = "";
}

function nowClock() {
  $("clock").textContent = new Date().toLocaleString();
}

// ---------- Item Picker ----------
const ITEMS_CACHE_KEY = "albion_itemsdb_v3";
const ITEMS_CACHE_TS  = "albion_itemsdb_ts_v3";
const ITEMS_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

// Mirrors (one may work if the other is blocked)
const ITEM_DB_URLS = [
  "https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/items.json",
  "https://raw.githubusercontent.com/broderickhyman/ao-bin-dumps/master/formatted/items.json"
];

let ITEMS = []; // normalized
let selectedItemId = "T4_BAG";

function normalizeItem(raw) {
  const id = raw.UniqueName || raw.uniqueName || raw.unique_name || raw.item_id || raw.id || "";
  const name =
    raw.LocalizedNames?.["EN-US"] ||
    raw.LocalizedNames?.EN ||
    raw.localizedName ||
    raw.Name || raw.name || "";
  const tier = raw.Tier || raw.tier || "";
  const category = raw.ItemType || raw.itemType || raw.Category || raw.category || "";
  return {
    id: String(id).trim(),
    name: String(name).trim(),
    tier: String(tier).trim(),
    category: String(category).trim(),
  };
}

function readCachedItems() {
  try {
    const ts = Number(localStorage.getItem(ITEMS_CACHE_TS) || 0);
    const raw = localStorage.getItem(ITEMS_CACHE_KEY);
    if (!raw) return null;
    if ((Date.now() - ts) > ITEMS_MAX_AGE_MS) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch { return null; }
}

function writeCachedItems(arr) {
  localStorage.setItem(ITEMS_CACHE_KEY, JSON.stringify(arr));
  localStorage.setItem(ITEMS_CACHE_TS, String(Date.now()));
}

async function loadItems(force) {
  const info = $("itemsInfo");
  info.textContent = "Items: loading…";

  if (!force) {
    const cached = readCachedItems();
    if (cached) {
      ITEMS = cached.map(normalizeItem).filter(x => x.id);
      info.textContent = `Items: ${ITEMS.length.toLocaleString()}`;
      return true;
    }
  }

  for (const url of ITEM_DB_URLS) {
    try {
      const raw = await fetchJson(url);
      if (!Array.isArray(raw)) throw new Error("items.json not array");
      writeCachedItems(raw);
      ITEMS = raw.map(normalizeItem).filter(x => x.id);
      info.textContent = `Items: ${ITEMS.length.toLocaleString()}`;
      return true;
    } catch {
      // try next mirror
    }
  }

  ITEMS = [];
  info.textContent = "Items: failed to load";
  return false;
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function setSelectedItem(id, displayName) {
  selectedItemId = id;
  $("itemIdDisplay").textContent = id || "—";
  $("item").value = displayName || id || "";
}

function openPicker() {
  $("pickerBackdrop").style.display = "flex";
  $("pickerSearch").value = "";
  renderPickerResults("");
  $("pickerSearch").focus();
}

function closePicker() {
  $("pickerBackdrop").style.display = "none";
}

function scoreMatch(query, it) {
  const q = query.toLowerCase().trim();
  const name = (it.name || "").toLowerCase();
  const id = (it.id || "").toLowerCase();
  if (!q) return 0;

  let s = 0;
  if (name === q) s += 1000;
  if (id === q) s += 900;
  if (name.startsWith(q)) s += 260;
  if (id.startsWith(q)) s += 230;
  if (name.includes(q)) s += 140;
  if (id.includes(q)) s += 120;

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    let hits = 0;
    for (const t of tokens) if (name.includes(t) || id.includes(t)) hits++;
    s += hits * 40;
  }
  return s;
}

function renderPickerResults(q) {
  const host = $("pickerResults");

  if (!ITEMS.length) {
    host.innerHTML = `
      <div class="resultRow">
        <div class="rLeft">
          <div class="rName">Item list not loaded</div>
          <div class="rMeta">Click “Reload list”. If your network blocks it, you can still use item_id manually.</div>
        </div>
        <div class="rId">—</div>
      </div>`;
    return;
  }

  const query = String(q || "");
  if (query.trim().length < 2) {
    host.innerHTML = `
      <div class="resultRow">
        <div class="rLeft">
          <div class="rName">Type to search</div>
          <div class="rMeta">Try “bag”, “cape”, “omelette”, “t6”.</div>
        </div>
        <div class="rId">—</div>
      </div>`;
    return;
  }

  const matches = [];
  for (const it of ITEMS) {
    const s = scoreMatch(query, it);
    if (s > 0) matches.push({ s, it });
  }
  matches.sort((a, b) => b.s - a.s);

  const top = matches.slice(0, 60);
  if (!top.length) {
    host.innerHTML = `
      <div class="resultRow">
        <div class="rLeft">
          <div class="rName">No matches</div>
          <div class="rMeta">Try fewer words.</div>
        </div>
        <div class="rId">—</div>
      </div>`;
    return;
  }

  host.innerHTML = top.map(({it}) => {
    const title = it.name || it.id;
    const meta = [it.category, it.tier].filter(Boolean).join(" • ") || "—";
    return `
      <div class="resultRow" data-id="${escapeHtml(it.id)}" data-name="${escapeHtml(title)}">
        <div class="rLeft">
          <div class="rName">${escapeHtml(title)}</div>
          <div class="rMeta">${escapeHtml(meta)}</div>
        </div>
        <div class="rId">${escapeHtml(it.id)}</div>
      </div>`;
  }).join("");

  host.querySelectorAll(".resultRow[data-id]").forEach(row => {
    row.addEventListener("click", () => {
      const id = row.getAttribute("data-id");
      const name = row.getAttribute("data-name");
      setSelectedItem(id, name);
      closePicker();
    });
  });
}

// ---------- Chart ----------
const chartState = { points: [], meta: null };

function drawChart(points) {
  const canvas = $("chart");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  ctx.clearRect(0,0,W,H);

  const padL = 72, padR = 18, padT = 18, padB = 46;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const isLight = (document.documentElement.getAttribute("data-theme") === "light");

  if (!points.length) {
    ctx.fillStyle = isLight ? "rgba(10,15,24,.65)" : "rgba(255,255,255,.65)";
    ctx.font = "14px system-ui";
    ctx.fillText("No history data for this selection.", padL, padT + 24);
    chartState.points = [];
    chartState.meta = null;
    return;
  }

  const xs = points.map(p => p.t);
  const ys = points.map(p => p.v);

  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  const xScale = (x) => padL + ((x - minX) / (maxX - minX || 1)) * plotW;
  const yScale = (y) => padT + (1 - ((y - minY) / (maxY - minY || 1))) * plotH;

  // grid + y labels
  ctx.font = "12px system-ui";
  ctx.fillStyle = isLight ? "rgba(10,15,24,.65)" : "rgba(255,255,255,.65)";
  for (let i = 0; i <= 5; i++) {
    const yVal = minY + ((maxY - minY) * (i/5));
    const y = yScale(yVal);
    ctx.strokeStyle = isLight ? "rgba(10,15,24,.08)" : "rgba(255,255,255,.08)";
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillText(fmt(yVal.toFixed(0)), 10, y + 4);
  }

  // axes
  ctx.strokeStyle = isLight ? "rgba(10,15,24,.16)" : "rgba(255,255,255,.16)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, H - padB);
  ctx.lineTo(W - padR, H - padB);
  ctx.stroke();

  // area gradient
  const grad = ctx.createLinearGradient(0, padT, 0, H - padB);
  grad.addColorStop(0, "rgba(124,92,255,.35)");
  grad.addColorStop(1, "rgba(124,92,255,0)");
  ctx.fillStyle = grad;

  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xScale(p.t);
    const y = yScale(p.v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(xScale(points[points.length - 1].t), H - padB);
  ctx.lineTo(xScale(points[0].t), H - padB);
  ctx.closePath();
  ctx.fill();

  // line
  ctx.strokeStyle = "rgba(124,92,255,.95)";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xScale(p.t);
    const y = yScale(p.v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  chartState.points = points;
  chartState.meta = { minX, maxX, padL, padR, padT, padB, plotW, plotH, xScale, yScale };
}

function setupTooltip() {
  const canvas = $("chart");
  const tip = $("tip");
  const t1 = $("tipT1");
  const t2 = $("tipT2");

  function hide() { tip.style.opacity = "0"; }

  canvas.addEventListener("mouseleave", hide);
  canvas.addEventListener("mousemove", (e) => {
    if (!chartState.points.length || !chartState.meta) return hide();

    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);

    const m = chartState.meta;
    const xIn = clamp(mx, m.padL, m.padL + m.plotW);

    const targetT = m.minX + ((xIn - m.padL) / (m.plotW || 1)) * (m.maxX - m.minX);

    let best = 0;
    for (let i=1;i<chartState.points.length;i++){
      if (Math.abs(chartState.points[i].t - targetT) < Math.abs(chartState.points[best].t - targetT)) best = i;
    }
    const p = chartState.points[best];
    const px = m.xScale(p.t);
    const py = m.yScale(p.v);

    // redraw + crosshair
    drawChart(chartState.points);
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = "rgba(255,255,255,.20)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, m.padT); ctx.lineTo(px, canvas.height - m.padB); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(m.padL, py); ctx.lineTo(canvas.width - m.padR, py); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.beginPath(); ctx.arc(px, py, 3.6, 0, Math.PI*2); ctx.fill();

    t1.textContent = `${fmt(p.v)} avg`;
    t2.textContent = new Date(p.t).toLocaleString();

    tip.style.left = (px * (rect.width / canvas.width)) + "px";
    tip.style.top  = (py * (rect.height / canvas.height)) + "px";
    tip.style.opacity = "1";
  });
}

// ---------- Watchlist ----------
const WATCH_KEY = "albion_watchlist_v2";

function getWatchlist() {
  try {
    const raw = localStorage.getItem(WATCH_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function setWatchlist(list) {
  localStorage.setItem(WATCH_KEY, JSON.stringify(list));
  renderWatchlist();
}

function watchKeyOf(w) {
  return `${w.region}|${w.city}|${w.quality}|${w.scale}|${w.item}`;
}

function currentSelection() {
  return {
    region: $("region").value,
    city: $("city").value,
    quality: $("quality").value,
    scale: $("scale").value,
    item: selectedItemId
  };
}

function sparkSvg(points) {
  if (!points.length) return `<svg class="spark" viewBox="0 0 120 34" preserveAspectRatio="none"></svg>`;
  const w = 120, h = 34, pad = 3;
  const xs = points.map(p => p.t);
  const ys = points.map(p => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const x = (t) => pad + ((t - minX) / (maxX - minX || 1)) * (w - pad*2);
  const y = (v) => pad + (1 - ((v - minY) / (maxY - minY || 1))) * (h - pad*2);
  let d = "";
  points.forEach((p, i) => d += (i===0 ? "M" : "L") + x(p.t).toFixed(2) + "," + y(p.v).toFixed(2));
  return `
    <svg class="spark" viewBox="0 0 120 34" preserveAspectRatio="none">
      <path d="${d}" fill="none" stroke="rgba(124,92,255,.95)" stroke-width="2" />
    </svg>
  `;
}

async function loadSpark(w) {
  const base = baseUrl(w.region);
  const historyUrl =
    `${base}/api/v2/stats/history/${encodeURIComponent(w.item)}.json` +
    `?locations=${encodeURIComponent(w.city)}` +
    `&qualities=${encodeURIComponent(w.quality)}` +
    `&time-scale=${encodeURIComponent(w.scale)}`;
  const hist = await fetchJson(historyUrl);
  const series = (hist && hist[0] && hist[0].data) ? hist[0].data : [];
  return series
    .filter(pt => pt && pt.timestamp && (pt.avg_price || pt.avg_price === 0))
    .map(pt => ({ t: new Date(pt.timestamp).getTime(), v: Number(pt.avg_price) }))
    .sort((a,b) => a.t - b.t);
}

function renderWatchlist() {
  const list = getWatchlist();
  const host = $("watchlist");
  host.innerHTML = "";

  if (!list.length) {
    host.innerHTML = `<div class="pill"><span class="muted">Watchlist:</span> <strong>Empty</strong></div>`;
    return;
  }

  list.forEach((w) => {
    const keySafe = watchKeyOf(w).replaceAll("|","_");
    const div = document.createElement("div");
    div.className = "watchItem";
    div.innerHTML = `
      <div class="watchLeft" title="${escapeHtml(w.item)}">
        <div class="id">${escapeHtml(w.item)}</div>
        <div class="meta">${escapeHtml(w.region.toUpperCase())} • ${escapeHtml(w.city)} • Q${escapeHtml(w.quality)} • ${escapeHtml(w.scale)}h</div>
      </div>
      <div class="watchRight">
        <div class="mini" id="mini_${keySafe}">—</div>
        <div id="spark_${keySafe}">${sparkSvg([])}</div>
        <button class="iconBtn" type="button" title="Load" data-load="${escapeHtml(watchKeyOf(w))}">Load</button>
        <button class="iconBtn" type="button" title="Remove" data-del="${escapeHtml(watchKeyOf(w))}">✕</button>
      </div>
    `;
    host.appendChild(div);
  });

  host.querySelectorAll("[data-load]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-load");
      const w = getWatchlist().find(x => watchKeyOf(x) === key);
      if (!w) return;
      $("region").value = w.region;
      $("city").value = w.city;
      $("quality").value = w.quality;
      $("scale").value = w.scale;
      setSelectedItem(w.item, w.item);
      loadMain();
    });
  });

  host.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-del");
      const next = getWatchlist().filter(x => watchKeyOf(x) !== key);
      setWatchlist(next);
    });
  });

  // best-effort update minis/sparklines
  list.forEach(async (w) => {
    try {
      const pts = await loadSpark(w);
      const last = pts.length ? pts[pts.length - 1].v : null;
      const keySafe = watchKeyOf(w).replaceAll("|","_");
      const elMini = $(`mini_${keySafe}`);
      const elSpark = $(`spark_${keySafe}`);
      if (elMini) elMini.textContent = last === null ? "—" : fmt(last);
      if (elSpark) elSpark.innerHTML = sparkSvg(pts.slice(Math.max(0, pts.length - 40)));
    } catch {
      // ignore
    }
  });
}

// ---------- Main load ----------
let autoTimer = null;

async function loadMain() {
  clearErr();

  const sel = currentSelection();
  if (!sel.item) {
    showErr("Pick an item first.");
    return;
  }

  $("selText").textContent = `${sel.item} • ${sel.region.toUpperCase()} • ${sel.city} • Q${sel.quality} • ${sel.scale}h`;
  $("chartSub").textContent = `Avg price history (sell) • ${sel.city} • Q${sel.quality} • ${sel.scale}h`;

  const base = baseUrl(sel.region);

  const pricesUrl =
    `${base}/api/v2/stats/prices/${encodeURIComponent(sel.item)}.json` +
    `?locations=${encodeURIComponent(sel.city)}` +
    `&qualities=${encodeURIComponent(sel.quality)}`;

  const historyUrl =
    `${base}/api/v2/stats/history/${encodeURIComponent(sel.item)}.json` +
    `?locations=${encodeURIComponent(sel.city)}` +
    `&qualities=${encodeURIComponent(sel.quality)}` +
    `&time-scale=${encodeURIComponent(sel.scale)}`;

  $("loadBtn").textContent = "Loading…";
  $("loadBtn").disabled = true;

  try {
    const [hist, snap] = await Promise.all([fetchJson(historyUrl), fetchJson(pricesUrl)]);

    const series = (hist && hist[0] && hist[0].data) ? hist[0].data : [];
    const points = series
      .filter(pt => pt && pt.timestamp && (pt.avg_price || pt.avg_price === 0))
      .map(pt => ({ t: new Date(pt.timestamp).getTime(), v: Number(pt.avg_price) }))
      .sort((a,b) => a.t - b.t);

    drawChart(points);

    // snapshot table + KPIs
    const tbody = $("snap");
    tbody.innerHTML = "";

    let sellMin = null, sellDate = null, buyMax = null, buyDate = null;
    (snap || []).forEach(r => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(r.item_id || "")}</td>
        <td>${escapeHtml(r.city || "")}</td>
        <td>${escapeHtml(String(r.quality ?? ""))}</td>
        <td>${fmt(r.sell_price_min)}</td>
        <td>${dt(r.sell_price_min_date)}</td>
        <td>${fmt(r.buy_price_max)}</td>
        <td>${dt(r.buy_price_max_date)}</td>
      `;
      tbody.appendChild(tr);

      sellMin = r.sell_price_min;
      sellDate = r.sell_price_min_date;
      buyMax = r.buy_price_max;
      buyDate = r.buy_price_max_date;
    });

    $("kSell").textContent = fmt(sellMin);
    $("kSellD").textContent = dt(sellDate);
    $("kBuy").textContent = fmt(buyMax);
    $("kBuyD").textContent = dt(buyDate);

    if (points.length >= 2) {
      const first = points[0].v;
      const last = points[points.length - 1].v;
      const chg = last - first;
      const pct = first ? (chg / first) * 100 : 0;
      const arrow = chg >= 0 ? "▲" : "▼";
      $("kTrend").textContent = `${arrow} ${fmt(Math.abs(chg).toFixed(0))}`;
      $("kTrend").className = "value " + (chg >= 0 ? "good" : "bad");
      $("kTrendD").textContent = `${pct.toFixed(1)}% from first point`;
    } else {
      $("kTrend").textContent = "—";
      $("kTrend").className = "value";
      $("kTrendD").textContent = "Not enough history points";
    }

    toastOK(`Loaded: ${points.length} history points`);
    renderWatchlist();
  } catch (e) {
    showErr("Error loading market data.\n\n" + String(e));
  } finally {
    $("loadBtn").textContent = "Load";
    $("loadBtn").disabled = false;
  }
}

function updateAutoRefresh() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  const secs = Number($("autoRefresh").value || 0);
  if (secs > 0) autoTimer = setInterval(() => loadMain(), secs * 1000);
}

function addToWatchlist() {
  clearErr();
  const sel = currentSelection();
  if (!sel.item) { showErr("Pick an item first."); return; }
  const list = getWatchlist();
  const key = watchKeyOf(sel);
  if (list.some(x => watchKeyOf(x) === key)) { toastOK("Already in watchlist."); return; }
  list.unshift(sel);
  setWatchlist(list.slice(0, 25));
  toastOK("Added to watchlist.");
}

// ---------- Init ----------
function init() {
  setTheme(getTheme());

  $("themeBtn").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    setTheme(cur === "dark" ? "light" : "dark");
    if (chartState.points.length) drawChart(chartState.points);
  });

  nowClock();
  setInterval(nowClock, 1000);

  $("loadBtn").addEventListener("click", loadMain);
  $("refreshBtn").addEventListener("click", loadMain);
  $("addWatchBtn").addEventListener("click", addToWatchlist);
  $("clearWatchBtn").addEventListener("click", () => { setWatchlist([]); toastOK("Watchlist cleared."); });
  $("autoRefresh").addEventListener("change", updateAutoRefresh);

  // Picker wiring
  $("openPickerBtn").addEventListener("click", async () => {
    clearErr();
    if (!ITEMS.length) {
      const ok = await loadItems(false);
      $("itemsInfo").textContent = ok ? `Items: ${ITEMS.length.toLocaleString()}` : "Items: failed to load";
      if (!ok) showErr("Could not load item list. You can still use the market chart if you know item_id.");
    }
    openPicker();
  });

  $("closePickerBtn").addEventListener("click", closePicker);
  $("pickerBackdrop").addEventListener("click", (e) => {
    if (e.target === $("pickerBackdrop")) closePicker();
  });

  $("reloadItemsBtn").addEventListener("click", async () => {
    clearErr();
    const ok = await loadItems(true);
    $("itemsInfo").textContent = ok ? `Items: ${ITEMS.length.toLocaleString()}` : "Items: failed to load";
    renderPickerResults($("pickerSearch").value || "");
    if (!ok) showErr("Could not load item list (network/CORS).");
  });

  let t = null;
  $("pickerSearch").addEventListener("input", () => {
    const q = $("pickerSearch").value || "";
    if (t) clearTimeout(t);
    t = setTimeout(() => renderPickerResults(q), 80);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("pickerBackdrop").style.display === "flex") closePicker();
  });

  setupTooltip();
  renderWatchlist();
  updateAutoRefresh();

  // Default selection
  setSelectedItem("T4_BAG", "T4 Bag");
  $("selText").textContent = `${selectedItemId} • ${$("region").value.toUpperCase()} • ${$("city").value} • Q${$("quality").value} • ${$("scale").value}h`;

  // Best-effort pre-load items from cache (no network)
  loadItems(false).then(ok => {
    $("itemsInfo").textContent = ok ? `Items: ${ITEMS.length.toLocaleString()}` : "Items: —";
  });
}

init();

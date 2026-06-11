// ─────────────────────────────────────────────────────────────
//  Dashboards JANIS — frontend
//  Lee 1 JSON por día (public/data/dias/<fecha>.json) listado en index.json,
//  que produce el bot Python (cierre diario + intradía). NO consulta en vivo.
//  Modo DEMO (sin Firebase): saltea login y usa snapshot.json para previsualizar.
// ─────────────────────────────────────────────────────────────
import { firebaseConfig, FUNCTIONS_REGION, ALLOWED_DOMAIN } from "/firebase-config.js";

const DEMO = !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("TODO");

let auth = null, db = null;
if (!DEMO) {
  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js"),
  ]);
  const app = initializeApp(firebaseConfig);
  auth = { mod: authMod, inst: authMod.getAuth(app) };
  db = { mod: fsMod, inst: fsMod.getFirestore(app) };
}

const el = (id) => document.getElementById(id);
const loader = el("loader");
const moneyFmt = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat("es-AR");

// Estado
let SOURCE = "demo";       // "dias" | "demo"
let DIAS = [];             // fechas disponibles (desc)
let demoSnap = null;       // snapshot.json (modo demo)
let dayData = { ventas: {}, gestion: {} }; // datos del día actual (por tienda)
let storeCatalog = {}, regionMap = {}, codeToRegion = {}, selectedRegions = new Set();

const VENTAS_CARDS = [
  { key: "venta", label: "Vendido (cerrado)", money: true, tip: "Σ orders.total_amount de pedidos creados en la fecha." },
  { key: "pedidos", label: "Pedidos", tip: "Cantidad de pedidos creados en la fecha." },
  { key: "skus", label: "SKUs distintos", tip: "uniqExact(order_items.sku_commerce_id) en la fecha." },
  { key: "ticket", label: "Ticket promedio", money: true, tip: "venta / pedidos." },
  { key: "horas", label: "Prom. horas a entrega", suffix: " hs", tip: "avg horas creación→entrega real (order_steps delivery finished)." },
];
const GESTION_CARDS = [
  { key: "total", label: "Pedidos (entrega)", drill: true, tip: "Pedidos con entrega programada = fecha (orders.delivery_sla_end). Click = antigüedad." },
  { key: "entregado", label: "Entregado", accent: "ok", tip: "status_code = 'delivered'." },
  { key: "pendiente", label: "Pendiente", tip: "Estados no terminales (readyForDelivery, inDelivery, etc.)." },
  { key: "cancelado", label: "Cancelado", accent: "bad", tip: "canceled / cancelationRequested." },
  { key: "postergado", label: "Postergado", tip: "needsRescheduling." },
  { key: "no_entregado", label: "No entregado", accent: "bad", tip: "notDelivered." },
  { key: "facturado", label: "Facturados", tip: "Pedidos con factura (order_invoices)." },
];

init();
async function init() {
  await loadIndex();
  if (DEMO) { await loadRegions(); startApp("preview (demo)"); }
  else setupAuth();   // muestra el login YA; las regiones se cargan al entrar
}

function startApp(userLabel) {
  el("loginView").hidden = true; el("app").hidden = false; el("userBox").hidden = false;
  el("userEmail").textContent = userLabel + (SOURCE === "demo" ? " · datos de muestra" : "");
  const f = el("fechaInput");
  f.value = DIAS[0] || ayerISO();
  if (DIAS.length) f.max = DIAS[0];
  f.onchange = runDashboard;
  renderRegionChips();
  runDashboard();
}
function ayerISO() { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }

// ── Auth (prod) ──
function setupAuth() {
  const { GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } = auth.mod;
  const provider = new GoogleAuthProvider(); provider.setCustomParameters({ hd: ALLOWED_DOMAIN });

  // Mostrar el login de entrada: si Auth tarda o falla, igual se ve algo (nunca en blanco).
  el("loginView").hidden = false; el("app").hidden = true; el("userBox").hidden = true;

  const checkDomain = async (user) => {
    if (user && !(user.email || "").toLowerCase().endsWith("@" + ALLOWED_DOMAIN)) {
      await signOut(auth.inst); showLoginError(`Solo cuentas @${ALLOWED_DOMAIN}.`); return false;
    }
    return !!user;
  };

  el("loginBtn").onclick = async () => {
    el("loginError").hidden = true;
    try {
      const res = await signInWithPopup(auth.inst, provider);
      await checkDomain(res.user);
    } catch (e) {
      if (e.code === "auth/popup-blocked" || e.code === "auth/cancelled-popup-request" || e.code === "auth/popup-closed-by-user") {
        try { await signInWithRedirect(auth.inst, provider); } catch (e2) { showLoginError("No se pudo abrir el login."); }
      } else { showLoginError("No se pudo iniciar sesión: " + (e.code || e.message)); console.error(e); }
    }
  };
  el("logoutBtn").onclick = () => signOut(auth.inst);

  // Resultado del redirect (cuando el popup estaba bloqueado)
  getRedirectResult(auth.inst).then((r) => { if (r?.user) checkDomain(r.user); }).catch(() => {});

  onAuthStateChanged(auth.inst, async (user) => {
    const ok = user && (user.email || "").toLowerCase().endsWith("@" + ALLOWED_DOMAIN);
    if (ok) { await loadRegions(); startApp(user.email); }
    else { el("loginView").hidden = false; el("app").hidden = true; el("userBox").hidden = true; }
  });
}
function showLoginError(m) { const e = el("loginError"); e.textContent = m; e.hidden = false; }

// ── Navegación ──
document.querySelectorAll(".report-item").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll(".report-item").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    const v = b.dataset.view;
    el("viewDashboard").hidden = v !== "dashboard";
    el("viewNoEncontrados").hidden = v !== "noEncontrados";
    el("viewRegiones").hidden = v !== "regiones";
    if (v === "regiones") renderRegionsAdmin();
  };
});

// ── Carga de datos (índice + día) ──
async function loadIndex() {
  try {
    const idx = await fetch("/data/index.json").then((r) => { if (!r.ok) throw new Error("no index"); return r.json(); });
    DIAS = idx.dias || []; SOURCE = "dias";
  } catch {
    demoSnap = await fetch("/data/snapshot.json").then((r) => r.json()).catch(() => ({ dias: [], ventas: {}, gestion: {} }));
    DIAS = demoSnap.dias || []; SOURCE = "demo";
  }
}
async function loadDay(fecha) {
  if (SOURCE === "dias") {
    const d = await fetch(`/data/dias/${fecha}.json`).then((r) => { if (!r.ok) throw new Error("404"); return r.json(); }).catch(() => ({ ventas: {}, gestion: {} }));
    dayData = { ventas: d.ventas || {}, gestion: d.gestion || {} };
  } else {
    dayData = { ventas: (demoSnap.ventas || {})[fecha] || {}, gestion: (demoSnap.gestion || {})[fecha] || {} };
  }
}

function codigosSeleccionados() {
  if (selectedRegions.size === 0) return null;
  const set = new Set(); selectedRegions.forEach((r) => (regionMap[r] || []).forEach((c) => set.add(c)));
  return set;
}
const incluir = (cod, codes) => codes === null ? true : codes.has(cod);

// Suma los buckets (por tienda) de un objeto {cod:{...}} con filtro de región
function aggBuckets(buckets, codes) {
  const acc = {};
  for (const [cod, b] of Object.entries(buckets || {})) {
    if (!incluir(cod, codes)) continue;
    for (const [k, v] of Object.entries(b)) {
      if (typeof v === "number") acc[k] = (acc[k] || 0) + v;
      else if (v && typeof v === "object") { acc[k] = acc[k] || {}; for (const [kk, vv] of Object.entries(v)) acc[k][kk] = (acc[k][kk] || 0) + vv; }
    }
  }
  return acc;
}

// ── Dashboard ──
el("aplicarBtn").onclick = runDashboard;

async function runDashboard() {
  const fecha = el("fechaInput").value || ayerISO();
  const codes = codigosSeleccionados();
  loader.hidden = false;
  try {
    await loadDay(fecha);
    el("ventasFechaLbl").textContent = `(creados el ${fecha})`;
    el("regionTblHint").textContent = selectedRegions.size ? `· ${[...selectedRegions].join(", ")}` : "· todas";

    const v = aggBuckets(dayData.ventas, codes);
    const ventasVacio = !v.pedidos && codes;
    const ventasRow = { venta: v.venta || 0, pedidos: v.pedidos || 0, skus: v.skus || 0, ticket: v.pedidos ? Math.round(v.venta / v.pedidos) : 0, horas: v.horas_cnt ? +(v.horas_sum / v.horas_cnt).toFixed(1) : null };
    renderCards("cardsVentas", VENTAS_CARDS, ventasVacio ? {} : ventasRow);
    if (ventasVacio) el("ventasFechaLbl").textContent += " · (sin desglose por región en este día)";

    const g = aggBuckets(dayData.gestion, codes);
    renderCards("cardsGestion", GESTION_CARDS, g, fecha, codes);
    renderCanal(g.canal || {});
    renderRegionTable();
  } catch (e) { console.error(e); }
  finally { loader.hidden = true; }
}

function renderCards(containerId, defs, row, fecha, codes) {
  const c = el(containerId); c.innerHTML = "";
  defs.forEach((d) => {
    const v = row[d.key];
    const card = document.createElement("div");
    card.className = "card" + (d.accent ? " card-" + d.accent : "") + (d.drill ? " card-drill" : "");
    card.title = d.tip;
    const val = v === undefined || v === null ? "—" : d.money ? moneyFmt.format(v) : numFmt.format(v) + (d.suffix || "");
    card.innerHTML = `<div class="card-val">${val}</div><div class="card-lbl">${d.label} <span class="info">ⓘ</span></div>`;
    if (d.drill) card.onclick = () => openDrill(fecha, codes);
    c.appendChild(card);
  });
}

function renderCanal(canal) {
  const c = el("canalList"); const entries = Object.entries(canal);
  if (!entries.length) { c.innerHTML = '<span class="muted">Sin datos</span>'; return; }
  const total = entries.reduce((a, [, n]) => a + n, 0);
  c.innerHTML = entries.sort((a, b) => b[1] - a[1]).map(([k, n]) => {
    const pct = total ? Math.round((100 * n) / total) : 0;
    return `<div class="kv"><span>${k}</span><span><b>${numFmt.format(n)}</b> <span class="muted">${pct}%</span></span></div>`;
  }).join("");
}

function renderRegionTable() {
  const agg = {};
  for (const [cod, b] of Object.entries(dayData.gestion || {})) {
    const reg = codeToRegion[cod] || (String(cod).startsWith("__") ? "Otras" : "Sin asignar");
    const a = (agg[reg] = agg[reg] || { total: 0, entregado: 0, pendiente: 0, cancelado: 0 });
    a.total += b.total || 0; a.entregado += b.entregado || 0; a.pendiente += b.pendiente || 0; a.cancelado += b.cancelado || 0;
  }
  const thead = document.querySelector("#regionTable thead"), tbody = document.querySelector("#regionTable tbody");
  thead.innerHTML = "<tr><th>Región</th><th>Total</th><th>Entregado</th><th>% Entreg.</th><th>Pend.</th><th>Canc.</th></tr>";
  const rows = Object.entries(agg).sort((a, b) => b[1].total - a[1].total);
  tbody.innerHTML = rows.map(([reg, a]) => {
    const pct = a.total ? Math.round((100 * a.entregado) / a.total) : 0;
    return `<tr><td>${reg}</td><td>${numFmt.format(a.total)}</td><td>${numFmt.format(a.entregado)}</td><td><span class="pct">${pct}%</span></td><td>${numFmt.format(a.pendiente)}</td><td>${numFmt.format(a.cancelado)}</td></tr>`;
  }).join("") || '<tr><td class="muted">Sin datos</td></tr>';
}

// ── Drill-down antigüedad ──
function openDrill(fecha, codes) {
  el("modal").hidden = false;
  el("modalSubtitle").textContent = `Pedidos con entrega = ${fecha}: ¿cuándo se crearon?`;
  const g = aggBuckets(dayData.gestion, codes);
  const entries = Object.entries(g.antig || {}).map(([d, n]) => [Number(d), n]).sort((a, b) => a[0] - b[0]);
  if (!entries.length) { el("modalBody").innerHTML = '<div class="muted">Sin desglose para esta selección.</div>'; return; }
  const total = entries.reduce((a, [, n]) => a + n, 0);
  const prom = total ? entries.reduce((a, [d, n]) => a + d * n, 0) / total : 0;
  const max = Math.max(1, ...entries.map(([, n]) => n));
  const lbl = (d) => d === 0 ? "Mismo día" : d === 1 ? "1 día antes" : `${d} días antes`;
  el("modalBody").innerHTML =
    `<div class="prom-line">Promedio de antigüedad: <b>${prom.toFixed(1)} días</b> (≈ ${Math.round(prom * 24)} h) · Total ${numFmt.format(total)}</div>` +
    entries.map(([d, n]) => `<div class="age-row"><span class="age-lbl">${lbl(d)}</span><span class="age-bar"><span style="width:${Math.round((100 * n) / max)}%"></span></span><span class="age-val">${numFmt.format(n)}</span></div>`).join("");
}
el("modalClose").onclick = () => (el("modal").hidden = true);
el("modal").onclick = (e) => { if (e.target === el("modal")) el("modal").hidden = true; };

// ── Productos no encontrados (requiere backend en vivo) ──
el("runNoEnc").onclick = async () => {
  if (DEMO) { el("noEncStatus").textContent = "Disponible con el backend deployado (consulta en vivo)."; return; }
  loader.hidden = false; el("noEncStatus").textContent = "Consultando…";
  try {
    const fns = await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js");
    const run = fns.httpsCallable(fns.getFunctions(auth.inst.app, FUNCTIONS_REGION), "runQuery");
    const { data } = await run({ queryId: "productos_no_encontrados", params: { dias: Number(el("diasInput").value) || 1 } });
    renderGenericTable("noEncTable", data.rows || []);
    el("noEncStatus").textContent = `${(data.rows || []).length} filas.`;
  } catch (e) { el("noEncStatus").textContent = "Error: " + (e.message || e); }
  finally { loader.hidden = true; }
};
function renderGenericTable(tableId, rows) {
  const thead = document.querySelector(`#${tableId} thead`), tbody = document.querySelector(`#${tableId} tbody`);
  if (!rows.length) { thead.innerHTML = ""; tbody.innerHTML = '<tr><td class="muted">Sin resultados.</td></tr>'; return; }
  const cols = Object.keys(rows[0]);
  thead.innerHTML = "<tr>" + cols.map((c) => `<th>${c}</th>`).join("") + "</tr>";
  tbody.innerHTML = rows.slice(0, 1000).map((r) => "<tr>" + cols.map((c) => `<td>${esc(r[c])}</td>`).join("") + "</tr>").join("");
}
function esc(v) { return v == null ? "" : String(v).replace(/[<>&]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[m])); }

// ── Regiones (seed + persistencia) ──
async function loadRegions() {
  const seed = await fetch("/data/regiones-default.json").then((r) => r.json()).catch(() => ({}));
  storeCatalog = {}; const defaultMap = {};
  for (const [region, tiendas] of Object.entries(seed)) {
    defaultMap[region] = tiendas.map((t) => t.cod);
    tiendas.forEach((t) => (storeCatalog[t.cod] = { nombre: t.nombre, provincia: t.provincia, ciudad: t.ciudad }));
  }
  let saved = null;
  if (DEMO) { try { saved = JSON.parse(localStorage.getItem("regiones") || "null"); } catch {} }
  else {
    try {
      const getOnce = db.mod.getDoc(db.mod.doc(db.inst, "config", "regiones"));
      const s = await Promise.race([getOnce, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000))]);
      if (s.exists()) saved = s.data().map;
    } catch (e) { console.warn("regiones: usando default (", e.message, ")"); }
  }
  regionMap = saved || defaultMap; rebuildCodeToRegion();
}
function rebuildCodeToRegion() { codeToRegion = {}; for (const [r, codes] of Object.entries(regionMap)) codes.forEach((c) => (codeToRegion[c] = r)); }

function renderRegionChips() {
  const cont = el("regionChips"); cont.innerHTML = "";
  const all = document.createElement("button");
  all.className = "chip" + (selectedRegions.size === 0 ? " on" : ""); all.textContent = "Todas";
  all.onclick = () => { selectedRegions.clear(); renderRegionChips(); runDashboard(); };
  cont.appendChild(all);
  Object.keys(regionMap).sort().forEach((r) => {
    const c = document.createElement("button");
    c.className = "chip" + (selectedRegions.has(r) ? " on" : "");
    c.textContent = `${r} (${(regionMap[r] || []).length})`;
    c.onclick = () => { selectedRegions.has(r) ? selectedRegions.delete(r) : selectedRegions.add(r); renderRegionChips(); runDashboard(); };
    cont.appendChild(c);
  });
}

function renderRegionsAdmin() {
  const cont = el("regionsAdmin"); const regiones = Object.keys(regionMap).sort();
  cont.innerHTML = regiones.map((reg) => {
    const tiendas = (regionMap[reg] || []).slice().sort((a, b) => (storeCatalog[a]?.nombre || a).localeCompare(storeCatalog[b]?.nombre || b));
    const items = tiendas.map((cod) => {
      const s = storeCatalog[cod] || {};
      const opts = regiones.map((r) => `<option value="${r}" ${r === reg ? "selected" : ""}>${r}</option>`).join("");
      return `<div class="store-row"><span class="store-name">${esc(s.nombre || cod)} <span class="muted">· ${cod}${s.provincia ? " · " + esc(s.provincia) : ""}</span></span><select data-cod="${cod}" class="move-sel">${opts}</select></div>`;
    }).join("");
    return `<div class="region-block"><div class="region-head"><b>${reg}</b> <span class="muted">${tiendas.length} tiendas</span></div>${items || '<div class="muted">— sin tiendas —</div>'}</div>`;
  }).join("");
  cont.querySelectorAll(".move-sel").forEach((sel) => (sel.onchange = () => moveStore(sel.dataset.cod, sel.value)));
}
function moveStore(cod, toRegion) {
  for (const r of Object.keys(regionMap)) regionMap[r] = regionMap[r].filter((c) => c !== cod);
  (regionMap[toRegion] = regionMap[toRegion] || []).push(cod);
  rebuildCodeToRegion(); renderRegionsAdmin(); setRegionsStatus("Cambios sin guardar…", "warn");
}
el("addRegionBtn").onclick = () => { const n = prompt("Nombre de la nueva región:"); if (n && !regionMap[n]) { regionMap[n] = []; renderRegionsAdmin(); renderRegionChips(); } };
el("resetRegionsBtn").onclick = async () => {
  if (!confirm("¿Restaurar regiones por defecto?")) return;
  const seed = await fetch("/data/regiones-default.json").then((r) => r.json());
  regionMap = {}; for (const [r, t] of Object.entries(seed)) regionMap[r] = t.map((x) => x.cod);
  rebuildCodeToRegion(); renderRegionsAdmin(); renderRegionChips(); setRegionsStatus("Restaurado (recordá Guardar).", "warn");
};
el("saveRegionsBtn").onclick = async () => {
  try {
    setRegionsStatus("Guardando…");
    if (DEMO) localStorage.setItem("regiones", JSON.stringify(regionMap));
    else await db.mod.setDoc(db.mod.doc(db.inst, "config", "regiones"), { map: regionMap, updatedBy: auth.inst.currentUser?.email || "", updatedAt: new Date().toISOString() });
    setRegionsStatus("✓ Guardado." + (DEMO ? " (local, modo demo)" : ""), "ok"); renderRegionChips();
  } catch (e) { setRegionsStatus("Error: " + (e.message || e), "bad"); }
};
function setRegionsStatus(msg, kind) { const s = el("regionsStatus"); s.textContent = msg; s.className = "muted" + (kind === "ok" ? " ok" : kind === "bad" ? " error" : kind === "warn" ? " warn" : ""); }

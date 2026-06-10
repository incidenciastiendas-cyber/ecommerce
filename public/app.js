// ─────────────────────────────────────────────────────────────
//  Dashboards JANIS — frontend (solo lectura, con admin de regiones)
// ─────────────────────────────────────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";
import {
  getFirestore, doc, getDoc, setDoc,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { firebaseConfig, FUNCTIONS_REGION, ALLOWED_DOMAIN } from "/firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const functions = getFunctions(app, FUNCTIONS_REGION);
const db = getFirestore(app);

const el = (id) => document.getElementById(id);
const loader = el("loader");
const moneyFmt = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat("es-AR");

// Estado
let storeCatalog = {};   // cod -> { nombre, provincia, ciudad }
let regionMap = {};      // region -> [cod, ...]
let codeToRegion = {};   // cod -> region
let selectedRegions = new Set(); // vacío = todas

// ── Definición de indicadores (nombre español + métrica real para el tooltip) ──
const VENTAS_CARDS = [
  { key: "venta_pesos", label: "Vendido (cerrado)", money: true,
    tip: "Σ orders.total_amount de los pedidos creados en la fecha (dedup por pedido, último valor)." },
  { key: "pedidos", label: "Pedidos", tip: "Cantidad de pedidos creados en la fecha." },
  { key: "skus_distintos", label: "SKUs distintos", tip: "uniqExact(order_items.sku_commerce_id) de ítems creados en la fecha (sin removidos)." },
  { key: "ticket_promedio", label: "Ticket promedio", money: true, tip: "avg(total_amount) por pedido." },
  { key: "prom_horas_entrega", label: "Prom. horas a entrega", suffix: " hs",
    tip: "avg de horas entre creación del pedido y entrega real (order_steps: step_name='delivery', step_status='finished')." },
];
const GESTION_CARDS = [
  { key: "pedidos", label: "Pedidos (entrega)", drill: true,
    tip: "Pedidos con entrega programada = fecha (orders.delivery_sla_end). Click = desglose por antigüedad." },
  { key: "entregado", label: "Entregado", accent: "ok", tip: "status_code = 'delivered'." },
  { key: "pendiente", label: "Pendiente", tip: "Estados no terminales (readyForDelivery, picking, inDelivery, etc.)." },
  { key: "cancelado", label: "Cancelado", accent: "bad", tip: "status_code IN ('canceled','cancelationRequested')." },
  { key: "postergado", label: "Postergado", tip: "status_code = 'needsRescheduling'." },
  { key: "no_entregado", label: "No entregado", accent: "bad", tip: "status_code = 'notDelivered'." },
  { key: "facturados", label: "Facturados", tip: "Pedidos con factura en order_invoices." },
];

// ── Auth ──
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ hd: ALLOWED_DOMAIN });

el("loginBtn").onclick = async () => {
  el("loginError").hidden = true;
  try {
    const res = await signInWithPopup(auth, provider);
    if (!(res.user.email || "").toLowerCase().endsWith("@" + ALLOWED_DOMAIN)) {
      await signOut(auth);
      showLoginError(`Solo cuentas @${ALLOWED_DOMAIN}.`);
    }
  } catch (e) { showLoginError("No se pudo iniciar sesión."); console.error(e); }
};
el("logoutBtn").onclick = () => signOut(auth);
function showLoginError(m) { const e = el("loginError"); e.textContent = m; e.hidden = false; }

onAuthStateChanged(auth, async (user) => {
  const ok = user && (user.email || "").toLowerCase().endsWith("@" + ALLOWED_DOMAIN);
  el("loginView").hidden = !!ok;
  el("app").hidden = !ok;
  el("userBox").hidden = !ok;
  if (ok) {
    el("userEmail").textContent = user.email;
    el("fechaInput").value = ayerISO();
    await loadRegions();
    renderRegionChips();
    runDashboard();
  }
});

function ayerISO() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ── Navegación entre vistas ──
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

// ── Llamada al backend ──
async function callQuery(queryId, params = {}) {
  const run = httpsCallable(functions, "runQuery");
  const { data } = await run({ queryId, params });
  return data.rows || [];
}

function tiendasSeleccionadas() {
  if (selectedRegions.size === 0) return []; // todas
  const codes = [];
  selectedRegions.forEach((r) => (regionMap[r] || []).forEach((c) => codes.push(c)));
  return codes;
}

// ── REGIONES: carga (seed + Firestore) ──
async function loadRegions() {
  // 1) seed (catálogo de tiendas + mapping default)
  const seed = await fetch("/data/regiones-default.json").then((r) => r.json()).catch(() => ({}));
  storeCatalog = {};
  const defaultMap = {};
  for (const [region, tiendas] of Object.entries(seed)) {
    defaultMap[region] = tiendas.map((t) => t.cod);
    tiendas.forEach((t) => (storeCatalog[t.cod] = { nombre: t.nombre, provincia: t.provincia, ciudad: t.ciudad }));
  }
  // 2) Firestore override (si existe)
  try {
    const snap = await getDoc(doc(db, "config", "regiones"));
    regionMap = snap.exists() && snap.data().map ? snap.data().map : defaultMap;
  } catch (e) {
    console.warn("Firestore no disponible, uso default", e);
    regionMap = defaultMap;
  }
  rebuildCodeToRegion();
}
function rebuildCodeToRegion() {
  codeToRegion = {};
  for (const [region, codes] of Object.entries(regionMap)) codes.forEach((c) => (codeToRegion[c] = region));
}

function renderRegionChips() {
  const cont = el("regionChips");
  cont.innerHTML = "";
  const all = document.createElement("button");
  all.className = "chip" + (selectedRegions.size === 0 ? " on" : "");
  all.textContent = "Todas";
  all.onclick = () => { selectedRegions.clear(); renderRegionChips(); };
  cont.appendChild(all);
  Object.keys(regionMap).sort().forEach((r) => {
    const c = document.createElement("button");
    c.className = "chip" + (selectedRegions.has(r) ? " on" : "");
    c.textContent = `${r} (${(regionMap[r] || []).length})`;
    c.onclick = () => { selectedRegions.has(r) ? selectedRegions.delete(r) : selectedRegions.add(r); renderRegionChips(); };
    cont.appendChild(c);
  });
}

// ── DASHBOARD ──
el("aplicarBtn").onclick = runDashboard;

async function runDashboard() {
  const fecha = el("fechaInput").value || ayerISO();
  const tiendas = tiendasSeleccionadas();
  el("ventasFechaLbl").textContent = `(creados el ${fecha})`;
  el("regionTblHint").textContent = selectedRegions.size ? `· ${[...selectedRegions].join(", ")}` : "· todas";
  loader.hidden = false;
  try {
    const [ventas, gestion, canal, porTienda] = await Promise.all([
      callQuery("ventas_resumen", { fecha, tiendas }),
      callQuery("gestion_resumen", { fecha, tiendas }),
      callQuery("gestion_por_canal", { fecha, tiendas }),
      callQuery("gestion_por_tienda", { fecha, tiendas }),
    ]);
    renderCards("cardsVentas", VENTAS_CARDS, ventas[0] || {});
    renderCards("cardsGestion", GESTION_CARDS, gestion[0] || {}, fecha, tiendas);
    renderCanal(canal);
    renderRegionTable(porTienda);
  } catch (e) {
    console.error(e);
    alert("Error al consultar: " + (e.message || e));
  } finally {
    loader.hidden = true;
  }
}

function renderCards(containerId, defs, row, fecha, tiendas) {
  const c = el(containerId);
  c.innerHTML = "";
  defs.forEach((d) => {
    const v = row[d.key];
    const card = document.createElement("div");
    card.className = "card" + (d.accent ? " card-" + d.accent : "") + (d.drill ? " card-drill" : "");
    card.title = d.tip; // tooltip con la métrica real
    const val = v === undefined || v === null ? "—"
      : d.money ? moneyFmt.format(v)
      : numFmt.format(v) + (d.suffix || "");
    card.innerHTML = `<div class="card-val">${val}</div><div class="card-lbl">${d.label} <span class="info">ⓘ</span></div>`;
    if (d.drill) card.onclick = () => openDrill(fecha, tiendas);
    c.appendChild(card);
  });
}

function renderCanal(rows) {
  const c = el("canalList");
  if (!rows.length) { c.innerHTML = '<span class="muted">Sin datos</span>'; return; }
  const total = rows.reduce((a, r) => a + Number(r.pedidos), 0);
  c.innerHTML = rows.map((r) => {
    const pct = total ? Math.round((100 * r.pedidos) / total) : 0;
    return `<div class="kv"><span>${r.canal}</span><span><b>${numFmt.format(r.pedidos)}</b> <span class="muted">${pct}%</span></span></div>`;
  }).join("");
}

function renderRegionTable(porTienda) {
  // Agregar por región (cliente)
  const agg = {};
  porTienda.forEach((t) => {
    const reg = codeToRegion[t.cod_tienda] || "Sin asignar";
    const a = (agg[reg] = agg[reg] || { total: 0, entregado: 0, pendiente: 0, cancelado: 0 });
    a.total += Number(t.total); a.entregado += Number(t.entregado);
    a.pendiente += Number(t.pendiente); a.cancelado += Number(t.cancelado);
  });
  const thead = document.querySelector("#regionTable thead");
  const tbody = document.querySelector("#regionTable tbody");
  thead.innerHTML = "<tr><th>Región</th><th>Total</th><th>Entregado</th><th>% Entreg.</th><th>Pend.</th><th>Canc.</th></tr>";
  const rows = Object.entries(agg).sort((a, b) => b[1].total - a[1].total);
  tbody.innerHTML = rows.map(([reg, a]) => {
    const pct = a.total ? Math.round((100 * a.entregado) / a.total) : 0;
    return `<tr><td>${reg}</td><td>${numFmt.format(a.total)}</td><td>${numFmt.format(a.entregado)}</td>
      <td><span class="pct">${pct}%</span></td><td>${numFmt.format(a.pendiente)}</td><td>${numFmt.format(a.cancelado)}</td></tr>`;
  }).join("") || '<tr><td class="muted">Sin datos</td></tr>';
}

// ── Drill-down: antigüedad ──
async function openDrill(fecha, tiendas) {
  el("modal").hidden = false;
  el("modalSubtitle").textContent = `Pedidos con entrega = ${fecha}: ¿cuándo se crearon?`;
  el("modalBody").innerHTML = '<div class="muted">Cargando…</div>';
  try {
    const rows = await callQuery("gestion_antiguedad", { fecha, tiendas });
    const total = rows.reduce((a, r) => a + Number(r.pedidos), 0);
    const promDias = total ? (rows.reduce((a, r) => a + r.dias_antiguedad * r.pedidos, 0) / total) : 0;
    const max = Math.max(1, ...rows.map((r) => Number(r.pedidos)));
    const lbl = (d) => d === 0 ? "Mismo día" : d === 1 ? "1 día antes" : `${d} días antes`;
    el("modalBody").innerHTML =
      `<div class="prom-line">Promedio de antigüedad: <b>${promDias.toFixed(1)} días</b> (≈ ${Math.round(promDias * 24)} h) · Total ${numFmt.format(total)}</div>` +
      rows.map((r) => {
        const w = Math.round((100 * r.pedidos) / max);
        return `<div class="age-row"><span class="age-lbl">${lbl(r.dias_antiguedad)}</span>
          <span class="age-bar"><span style="width:${w}%"></span></span>
          <span class="age-val">${numFmt.format(r.pedidos)}</span></div>`;
      }).join("");
  } catch (e) {
    el("modalBody").innerHTML = '<div class="error">Error: ' + (e.message || e) + "</div>";
  }
}
el("modalClose").onclick = () => (el("modal").hidden = true);
el("modal").onclick = (e) => { if (e.target === el("modal")) el("modal").hidden = true; };

// ── PRODUCTOS NO ENCONTRADOS ──
let noEncRows = [];
el("runNoEnc").onclick = async () => {
  loader.hidden = false;
  el("noEncStatus").textContent = "Consultando…";
  try {
    noEncRows = await callQuery("productos_no_encontrados", { dias: Number(el("diasInput").value) || 1 });
    renderGenericTable("noEncTable", noEncRows);
    el("noEncStatus").textContent = `${noEncRows.length} filas.`;
    el("exportNoEnc").disabled = noEncRows.length === 0;
  } catch (e) {
    el("noEncStatus").textContent = "Error: " + (e.message || e);
  } finally { loader.hidden = true; }
};
el("exportNoEnc").onclick = () => exportCSV(noEncRows, "productos_no_encontrados");

function renderGenericTable(tableId, rows) {
  const thead = document.querySelector(`#${tableId} thead`);
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!rows.length) { thead.innerHTML = ""; tbody.innerHTML = '<tr><td class="muted">Sin resultados.</td></tr>'; return; }
  const cols = Object.keys(rows[0]);
  thead.innerHTML = "<tr>" + cols.map((c) => `<th>${c}</th>`).join("") + "</tr>";
  tbody.innerHTML = rows.slice(0, 1000).map((r) =>
    "<tr>" + cols.map((c) => `<td>${esc(r[c])}</td>`).join("") + "</tr>").join("");
}
function esc(v) { return v == null ? "" : String(v).replace(/[<>&]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[m])); }
function exportCSV(rows, name) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => q(r[c])).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }));
  a.download = `${name}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ── REGIONES (admin) ──
function renderRegionsAdmin() {
  const cont = el("regionsAdmin");
  const regiones = Object.keys(regionMap).sort();
  cont.innerHTML = regiones.map((reg) => {
    const tiendas = (regionMap[reg] || []).slice().sort((a, b) =>
      (storeCatalog[a]?.nombre || a).localeCompare(storeCatalog[b]?.nombre || b));
    const items = tiendas.map((cod) => {
      const s = storeCatalog[cod] || {};
      const opts = regiones.map((r) => `<option value="${r}" ${r === reg ? "selected" : ""}>${r}</option>`).join("");
      return `<div class="store-row">
        <span class="store-name">${esc(s.nombre || cod)} <span class="muted">· ${cod}${s.provincia ? " · " + esc(s.provincia) : ""}</span></span>
        <select data-cod="${cod}" class="move-sel">${opts}</select>
      </div>`;
    }).join("");
    return `<div class="region-block"><div class="region-head"><b>${reg}</b> <span class="muted">${tiendas.length} tiendas</span></div>${items || '<div class="muted">— sin tiendas —</div>'}</div>`;
  }).join("");
  cont.querySelectorAll(".move-sel").forEach((sel) => {
    sel.onchange = () => moveStore(sel.dataset.cod, sel.value);
  });
}
function moveStore(cod, toRegion) {
  for (const r of Object.keys(regionMap)) regionMap[r] = regionMap[r].filter((c) => c !== cod);
  (regionMap[toRegion] = regionMap[toRegion] || []).push(cod);
  rebuildCodeToRegion();
  renderRegionsAdmin();
  setRegionsStatus("Cambios sin guardar…", "warn");
}
el("addRegionBtn").onclick = () => {
  const name = prompt("Nombre de la nueva región:");
  if (name && !regionMap[name]) { regionMap[name] = []; renderRegionsAdmin(); renderRegionChips(); }
};
el("resetRegionsBtn").onclick = async () => {
  if (!confirm("¿Restaurar el mapeo de regiones por defecto?")) return;
  const seed = await fetch("/data/regiones-default.json").then((r) => r.json());
  regionMap = {}; for (const [r, t] of Object.entries(seed)) regionMap[r] = t.map((x) => x.cod);
  rebuildCodeToRegion(); renderRegionsAdmin(); renderRegionChips();
  setRegionsStatus("Restaurado (recordá Guardar).", "warn");
};
el("saveRegionsBtn").onclick = async () => {
  try {
    setRegionsStatus("Guardando…");
    await setDoc(doc(db, "config", "regiones"), {
      map: regionMap, updatedBy: auth.currentUser?.email || "", updatedAt: new Date().toISOString(),
    });
    setRegionsStatus("✓ Guardado.", "ok");
    renderRegionChips();
  } catch (e) { setRegionsStatus("Error al guardar: " + (e.message || e), "bad"); }
};
function setRegionsStatus(msg, kind) {
  const s = el("regionsStatus"); s.textContent = msg;
  s.className = "muted" + (kind === "ok" ? " ok" : kind === "bad" ? " error" : kind === "warn" ? " warn" : "");
}

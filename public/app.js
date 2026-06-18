// ─────────────────────────────────────────────────────────────
//  Panel de Control · MásOnline — Dashboard Operativo E-Commerce
//  Lee public/data/snapshot.json (semana lunes→ayer) que arma el bot Python.
//  Solapas: Resumen / Coordinadores / Tiendas / Histórico. NO consulta en vivo.
// ─────────────────────────────────────────────────────────────
import { firebaseConfig, ALLOWED_DOMAIN } from "/firebase-config.js";

const DEMO = !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("TODO");
let auth = null;
if (!DEMO) {
  const [{ initializeApp }, authMod] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js"),
  ]);
  auth = { mod: authMod, inst: authMod.getAuth(initializeApp(firebaseConfig)) };
}

const el = (id) => document.getElementById(id);
const loader = el("loader");
const nf = new Intl.NumberFormat("es-AR");
const money = (n) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
let SNAP = null, histChart = null;

// Targets
const TGT = { ot_prep: 98, ot_del: 98, fillrate: 95, falt: 5 };
const cumple = (k, v) => v == null ? null : (k === "falt" ? v <= TGT.falt : v >= TGT[k]);
const lvlClass = (k, v) => { const c = cumple(k, v); return c === true ? "ok" : c === false ? "bad" : ""; };

init();
async function init() {
  try { SNAP = await fetch("/data/snapshot.json").then((r) => r.json()); }
  catch { SNAP = { meta: {}, sa: {}, coords: {}, stores: [], daily: [], ds: {} }; }
  if (DEMO) startApp("preview (demo)"); else setupAuth();
}

el("collapseBtn").onclick = () => el("app").classList.toggle("collapsed");

function startApp(userLabel) {
  el("loginView").hidden = true; el("app").hidden = false; el("userBox").hidden = false;
  el("userEmail").textContent = userLabel;
  el("semanaLbl").textContent = "Semana " + (SNAP.meta?.semana || "—");
  el("updLbl").textContent = SNAP.meta?.upd ? "Act: " + SNAP.meta.upd.slice(0, 16).replace("T", " ") : "";
  renderResumen();
}

// ── Auth ──
function setupAuth() {
  const { GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } = auth.mod;
  const provider = new GoogleAuthProvider(); provider.setCustomParameters({ hd: ALLOWED_DOMAIN });
  el("loginView").hidden = false; el("app").hidden = true; el("userBox").hidden = true;
  const chk = async (u) => { if (u && !(u.email || "").toLowerCase().endsWith("@" + ALLOWED_DOMAIN)) { await signOut(auth.inst); err(`Solo @${ALLOWED_DOMAIN}.`); return false; } return !!u; };
  el("loginBtn").onclick = async () => {
    el("loginError").hidden = true;
    try { await chk((await signInWithPopup(auth.inst, provider)).user); }
    catch (e) { if (["auth/popup-blocked","auth/cancelled-popup-request","auth/popup-closed-by-user"].includes(e.code)) { try { await signInWithRedirect(auth.inst, provider); } catch { err("No se pudo abrir el login."); } } else err("Error: " + (e.code || e.message)); }
  };
  el("logoutBtn").onclick = () => signOut(auth.inst);
  getRedirectResult(auth.inst).then((r) => { if (r?.user) chk(r.user); }).catch(() => {});
  onAuthStateChanged(auth.inst, (u) => { const ok = u && (u.email || "").toLowerCase().endsWith("@" + ALLOWED_DOMAIN); if (ok) startApp(u.email); else { el("loginView").hidden = false; el("app").hidden = true; el("userBox").hidden = true; } });
}
function err(m) { const e = el("loginError"); e.textContent = m; e.hidden = false; }

// ── Navegación ──
document.querySelectorAll(".report-item").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll(".report-item").forEach((x) => x.classList.remove("active")); b.classList.add("active");
    const v = b.dataset.view;
    el("viewResumen").hidden = v !== "resumen"; el("viewTop5").hidden = v !== "top5"; el("viewCoord").hidden = v !== "coord";
    el("viewTiendas").hidden = v !== "tiendas"; el("viewHistorico").hidden = v !== "historico";
    if (v === "resumen") renderResumen(); if (v === "top5") renderTop5(); if (v === "coord") renderCoord();
    if (v === "tiendas") renderTiendas(); if (v === "historico") renderHistorico();
  };
});

// Selector de período (Resumen)
let PERIOD = "semana";
document.querySelectorAll("#periodSel .pbtn").forEach((b) => {
  b.onclick = () => { document.querySelectorAll("#periodSel .pbtn").forEach((x) => x.classList.remove("active")); b.classList.add("active"); PERIOD = b.dataset.p; renderResumen(); };
});

// ot delivery global (ponderado por pedidos)
function otDelGlobal() { let n = 0, d = 0; (SNAP.stores || []).forEach((s) => { d += s.pedidos; n += (s.ot_del || 0) / 100 * s.pedidos; }); return d ? +(n / d * 100).toFixed(1) : 0; }

// ── RESUMEN ──
// Ventas según el período elegido. Semana -> sa (JANIS semanal). Otros -> desde daily (commerce_date_created).
function periodVentas() {
  const sa = SNAP.sa || {}, daily = (SNAP.daily || []).slice().sort((a, b) => a.f < b.f ? -1 : 1);
  if (PERIOD === "semana") return { venta: (sa.ventas_M || 0) * 1e6, pedidos: sa.pedidos || 0, ticket: sa.ticket_prom || 0, unidades: sa.unidades || 0, hd: sa.pct_hd || 0, rt: sa.pct_rt || 0, dt: sa.pct_dt || 0, pct: true, label: "Semana " + (sa.semana || "") };
  const hoy = daily[daily.length - 1], ayer = daily[daily.length - 2];
  let sel = [], label = "";
  if (PERIOD === "hoy") { sel = hoy ? [hoy] : []; label = "Hoy " + (hoy ? hoy.f : "") + " · en curso"; }
  else if (PERIOD === "ayer") { sel = ayer ? [ayer] : []; label = "Día cerrado " + (ayer ? ayer.f : ""); }
  else if (PERIOD === "mtd") { const ym = (ayer ? ayer.f : "").slice(0, 7); sel = daily.filter((d) => d.f.slice(0, 7) === ym && d.f <= (ayer ? ayer.f : "")); label = "Mes a la fecha (" + ym + ")"; }
  const sum = (k) => sel.reduce((a, d) => a + (d[k] || 0), 0);
  const venta = sum("v") * 1e6, ped = sum("p"), hd = sum("hd"), rt = sum("rt"), dt = sum("dt");
  return { venta, pedidos: ped, ticket: ped ? Math.round(venta / ped) : 0, unidades: sum("u"), hd, rt, dt, pct: false, mixTot: hd + rt + dt, label };
}

function renderResumen() {
  const sa = SNAP.sa || {}, pv = periodVentas();
  el("periodLbl").textContent = "· " + pv.label;
  card("kpisVenta", [
    { v: money(pv.venta), l: "Venta" }, { v: nf.format(pv.pedidos), l: "Pedidos" },
    { v: money(pv.ticket), l: "Ticket promedio" }, { v: nf.format(pv.unidades), l: "Unidades" },
  ]);
  // Operativo: SIEMPRE semanal (criterio del documento técnico)
  const otd = otDelGlobal();
  card("kpisOper", [
    { v: (sa.ot_prep ?? 0) + "%", l: "OT Preparación", k: "ot_prep", val: sa.ot_prep },
    { v: otd + "%", l: "OT Delivery", k: "ot_del", val: otd },
    { v: (sa.fillrate ?? 0) + "%", l: "Order Fillrate", k: "fillrate", val: sa.fillrate },
    { v: (sa.falt_pct ?? 0) + "%", l: "% Faltantes", k: "falt", val: sa.falt_pct },
  ]);
  // Mix del período
  const t = pv.pct ? 100 : (pv.mixTot || 1);
  const pc = (x) => pv.pct ? (x || 0) : Math.round(100 * x / t);
  el("mixList").innerHTML = [["Envío a domicilio (HD)", pv.hd], ["Retiro en tienda", pv.rt], ["Drive through", pv.dt]]
    .map(([k, v]) => `<div class="kv"><span>${k}</span><span><b>${pc(v)}%</b></span></div>`).join("");
  // VS LW (solo tiene sentido en Semana)
  if (PERIOD === "semana") {
    const arrow = (x) => x >= 0 ? `<span class="up">▲ ${x}%</span>` : `<span class="down">▼ ${x}%</span>`;
    el("vslwBox").innerHTML =
      `<div class="kv"><span>Pedidos</span><span>${arrow(sa.var_ped_lw || 0)} <span class="muted">(${nf.format(sa.ped_ant || 0)} sem. ant.)</span></span></div>
       <div class="kv"><span>Venta</span><span>${arrow(sa.var_ven_lw || 0)} <span class="muted">($${sa.ven_ant_M || 0}M sem. ant.)</span></span></div>
       <p class="muted mini">Si la semana está en curso compara parcial vs semana completa anterior (se normaliza al cerrar).</p>`;
  } else {
    el("vslwBox").innerHTML = '<p class="muted">El comparativo vs semana anterior se muestra en la vista <b>Semana</b>.</p>';
  }
}

// ── TOP 5 ──
function renderTop5() {
  const st = (SNAP.stores || []).filter((s) => s.pedidos > 0);
  const top = (key, asc) => st.slice().sort((a, b) => asc ? a[key] - b[key] : b[key] - a[key]).slice(0, 5);
  const blk = (title, rows, valFn, kpi, kf) => `<div class="panel top5-block"><h4>${title}</h4>` +
    (rows.length ? rows.map((s, i) => `<div class="top5-row"><span class="rk">${i + 1}</span><span class="t5n">${esc(s.nombre)} <span class="muted">· ${s.coord}</span></span><span class="t5v ${kpi ? lvlClass(kpi, s[kf]) + "-t" : ""}">${valFn(s)}</span></div>`).join("") : '<div class="muted">Sin datos</div>') + "</div>";
  el("top5Grid").innerHTML = [
    blk("🥇 Top venta", top("ventas_M"), (s) => money(s.ventas_M * 1e6)),
    blk("📦 Top pedidos", top("pedidos"), (s) => nf.format(s.pedidos) + " ped"),
    blk("⚠️ Peor OT Preparación", top("ot_prep", true), (s) => s.ot_prep + "%", "ot_prep", "ot_prep"),
    blk("⚠️ Peor Fillrate", top("fillrate", true), (s) => s.fillrate + "%", "fillrate", "fillrate"),
    blk("⚠️ Más faltantes", top("falt_pct"), (s) => s.falt_pct + "%", "falt", "falt_pct"),
  ].join("");
}
function card(cont, items) {
  el(cont).innerHTML = items.map((i) => {
    const cls = i.k ? lvlClass(i.k, i.val) : "";
    const tgt = i.k ? `<span class="tgt ${cls}">${cumple(i.k, i.val) ? "✓" : "✕"} target ${i.k === "falt" ? "≤" + TGT.falt : "≥" + TGT[i.k]}%</span>` : "";
    return `<div class="card ${cls ? "card-" + cls : ""}"><div class="card-val">${i.v}</div><div class="card-lbl">${i.l}</div>${tgt}</div>`;
  }).join("");
}

// ── COORDINADORES ──
function renderCoord() {
  const co = SNAP.coords || {};
  el("coordCards").innerHTML = Object.entries(co).map(([nombre, c]) => `
    <div class="coord-card">
      <div class="coord-head"><b>${nombre}</b><span class="muted">${c.activas}/${c.tiendas} tiendas activas</span></div>
      <div class="coord-big">${money((c.ventas_M || 0) * 1e6)}</div>
      <div class="coord-sub">${c.share_pct}% del canal · ${nf.format(c.pedidos)} pedidos</div>
      <div class="coord-kpis">
        <span class="badge ${lvlClass("ot_prep", c.ot_prep)}">OT ${c.ot_prep}%</span>
        <span class="badge ${lvlClass("fillrate", c.fillrate)}">Fill ${c.fillrate}%</span>
        <span class="badge ${lvlClass("falt", c.falt_pct)}">Falt ${c.falt_pct}%</span>
      </div>
      <div class="coord-fmt muted">Full 1: ${c.f1} · Full 2: ${c.f2} · GM: ${c.gm}</div>
    </div>`).join("");
  const th = document.querySelector("#coordTable thead"), tb = document.querySelector("#coordTable tbody");
  th.innerHTML = "<tr><th>Coordinador</th><th>Venta</th><th>Share</th><th>Pedidos</th><th>Unidades</th><th>OT Prep</th><th>Fillrate</th><th>% Falt</th></tr>";
  tb.innerHTML = Object.entries(co).map(([n, c]) => `<tr><td><b>${n}</b></td><td>${money((c.ventas_M||0)*1e6)}</td><td>${c.share_pct}%</td><td>${nf.format(c.pedidos)}</td><td>${nf.format(c.unidades)}</td>
    <td class="${lvlClass("ot_prep",c.ot_prep)}-t">${c.ot_prep}%</td><td class="${lvlClass("fillrate",c.fillrate)}-t">${c.fillrate}%</td><td class="${lvlClass("falt",c.falt_pct)}-t">${c.falt_pct}%</td></tr>`).join("");
}

// ── TIENDAS ──
el("coordFilter").onchange = renderTiendas; el("sortBy").onchange = renderTiendas;
function renderTiendas() {
  const fc = el("coordFilter").value, sb = el("sortBy").value;
  let rows = (SNAP.stores || []).filter((s) => !fc || s.coord === fc);
  const asc = sb === "ot_prep" || sb === "fillrate" || sb === "ot_del"; // peor (menor) arriba
  rows = rows.slice().sort((a, b) => sb === "falt_pct" ? b.falt_pct - a.falt_pct : asc ? a[sb] - b[sb] : b[sb] - a[sb]);
  el("tiResumen").textContent = `${rows.length} tiendas`;
  const th = document.querySelector("#tiendasTable thead"), tb = document.querySelector("#tiendasTable tbody");
  th.innerHTML = "<tr><th>Tienda</th><th>Coord</th><th>Fmt</th><th>Venta</th><th>Ped.</th><th>Ticket</th><th>HD/RT/DT</th><th>OT Prep</th><th>OT Del</th><th>Fillrate</th><th>% Falt</th><th>Reprog</th></tr>";
  tb.innerHTML = rows.map((s) => `<tr>
    <td><b>${esc(s.nombre)}</b> <span class="muted">${s.num}</span></td><td>${s.coord}</td><td>${s.formato}</td>
    <td>${money(s.ventas_M*1e6)}</td><td>${nf.format(s.pedidos)}</td><td>${money(s.ticket_prom)}</td>
    <td class="muted">${s.hd_p}/${s.rt_p}/${s.dt_p}</td>
    <td class="cell-${lvlClass("ot_prep",s.ot_prep)}">${s.ot_prep}%</td>
    <td class="cell-${lvlClass("ot_del",s.ot_del)}">${s.ot_del}%</td>
    <td class="cell-${lvlClass("fillrate",s.fillrate)}">${s.fillrate}%</td>
    <td class="cell-${lvlClass("falt",s.falt_pct)}">${s.falt_pct}%</td>
    <td>${s.reprog_pct}%</td></tr>`).join("") || '<tr><td class="muted">Sin datos</td></tr>';
}

// ── HISTÓRICO ──
function renderHistorico() {
  const d = (SNAP.daily || []).slice();
  const labels = d.map((x) => x.f.slice(5)); // MM-DD
  if (window.Chart) {
    if (histChart) histChart.destroy();
    histChart = new Chart(el("histChart"), {
      data: { labels, datasets: [
        { type: "bar", label: "Venta ($M)", data: d.map((x) => x.v), backgroundColor: "#00ac42", yAxisID: "y", borderRadius: 4 },
        { type: "line", label: "Pedidos", data: d.map((x) => x.p), borderColor: "#ff533b", backgroundColor: "#ff533b", yAxisID: "y1", tension: .3, pointRadius: 2 },
      ]},
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        scales: { y: { position: "left", title: { display: true, text: "$M" } }, y1: { position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Pedidos" } } },
        plugins: { legend: { position: "top" } } },
    });
  }
  const th = document.querySelector("#histTable thead"), tb = document.querySelector("#histTable tbody");
  th.innerHTML = "<tr><th>Fecha</th><th>Pedidos</th><th>Venta ($M)</th><th>Unidades</th><th>HD</th><th>RT</th><th>DT</th></tr>";
  tb.innerHTML = d.slice().reverse().map((x) => `<tr><td>${x.f}</td><td>${nf.format(x.p)}</td><td>$${x.v}M</td><td>${nf.format(x.u)}</td><td>${x.hd}</td><td>${x.rt}</td><td>${x.dt}</td></tr>`).join("");
}

function esc(v) { return v == null ? "" : String(v).replace(/[<>&]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[m])); }

// ─────────────────────────────────────────────────────────────
//  Dashboard JANIS — frontend (Firebase Auth + Cloud Functions)
//  Solo lectura. El SQL vive en el backend; acá pedimos por queryId.
// ─────────────────────────────────────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFunctions, httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";

import { firebaseConfig, FUNCTIONS_REGION, ALLOWED_DOMAIN } from "/firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const functions = getFunctions(app, FUNCTIONS_REGION);

// ── Elementos ──
const el = (id) => document.getElementById(id);
const loginView = el("loginView");
const dashboard = el("dashboard");
const userBox = el("userBox");
const loader = el("loader");

let currentReport = null;
let lastRows = [];

// ── Auth ──
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ hd: ALLOWED_DOMAIN }); // sugiere el dominio en el selector

el("loginBtn").onclick = async () => {
  el("loginError").hidden = true;
  try {
    const res = await signInWithPopup(auth, provider);
    const email = (res.user.email || "").toLowerCase();
    if (!email.endsWith("@" + ALLOWED_DOMAIN)) {
      await signOut(auth);
      showLoginError(`Solo cuentas @${ALLOWED_DOMAIN}.`);
    }
  } catch (e) {
    showLoginError("No se pudo iniciar sesión.");
    console.error(e);
  }
};

el("logoutBtn").onclick = () => signOut(auth);

function showLoginError(msg) {
  const e = el("loginError");
  e.textContent = msg;
  e.hidden = false;
}

onAuthStateChanged(auth, (user) => {
  const ok = user && (user.email || "").toLowerCase().endsWith("@" + ALLOWED_DOMAIN);
  loginView.hidden = !!ok;
  dashboard.hidden = !ok;
  userBox.hidden = !ok;
  if (ok) {
    el("userEmail").textContent = user.email;
    loadReports();
  }
});

// ── Cargar reportes disponibles ──
async function loadReports() {
  try {
    const list = httpsCallable(functions, "listAvailableQueries");
    const { data } = await list();
    renderReportNav(data.queries || []);
  } catch (e) {
    console.error("No se pudieron cargar los reportes", e);
  }
}

function renderReportNav(queries) {
  const nav = el("reportNav");
  nav.innerHTML = "";
  queries.forEach((q, i) => {
    const b = document.createElement("button");
    b.className = "report-item" + (i === 0 ? " active" : "");
    b.textContent = prettyName(q.id);
    b.onclick = () => selectReport(q, b);
    nav.appendChild(b);
    if (i === 0) selectReport(q, b);
  });
}

function prettyName(id) {
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function selectReport(q, btn) {
  currentReport = q;
  document.querySelectorAll(".report-item").forEach((x) => x.classList.remove("active"));
  if (btn) btn.classList.add("active");
  el("reportTitle").textContent = prettyName(q.id);
  el("reportDesc").textContent = q.description || "";
}

// ── Ejecutar reporte ──
el("runBtn").onclick = runReport;

async function runReport() {
  if (!currentReport) return;
  loader.hidden = false;
  el("status").textContent = "Consultando el data lake…";
  el("exportBtn").disabled = true;
  try {
    const run = httpsCallable(functions, "runQuery");
    const params = { dias: Number(el("diasInput").value) || 1 };
    const { data } = await run({ queryId: currentReport.id, params });
    lastRows = data.rows || [];
    renderTable(lastRows);
    el("status").textContent = `${data.count} filas.`;
    el("exportBtn").disabled = lastRows.length === 0;
  } catch (e) {
    el("status").textContent = "Error: " + (e.message || "no se pudo ejecutar");
    console.error(e);
  } finally {
    loader.hidden = true;
  }
}

function renderTable(rows) {
  const thead = document.querySelector("#resultsTable thead");
  const tbody = document.querySelector("#resultsTable tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = '<tr><td class="muted">Sin resultados.</td></tr>';
    return;
  }
  const cols = Object.keys(rows[0]);
  thead.innerHTML = "<tr>" + cols.map((c) => `<th>${c}</th>`).join("") + "</tr>";
  // Render acotado a 1000 filas en pantalla (exportá para el total).
  const view = rows.slice(0, 1000);
  tbody.innerHTML = view
    .map((r) => "<tr>" + cols.map((c) => `<td>${fmt(r[c])}</td>`).join("") + "</tr>")
    .join("");
}

function fmt(v) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/[<>&]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[m]));
}

// ── Exportar CSV ──
el("exportBtn").onclick = () => {
  if (!lastRows.length) return;
  const cols = Object.keys(lastRows[0]);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [cols.join(","), ...lastRows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${currentReport.id}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
};

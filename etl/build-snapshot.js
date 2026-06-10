// ─────────────────────────────────────────────────────────────
//  ETL: consulta ClickHouse y arma el snapshot de indicadores
//  (por tienda y por día, últimos 7 días) para el dashboard.
//  Corre cada 30 min (GitHub Actions) o local.  Credenciales por ENV.
//
//  Uso local:
//    CH_USER=.. CH_PASS=.. node etl/build-snapshot.js
//  Salida: public/data/snapshot.json
// ─────────────────────────────────────────────────────────────
const https = require("https");
const fs = require("fs");
const path = require("path");

const HOST = process.env.CLICKHOUSE_HOST || "quantics.data-lake.janis.in";
const PORT = process.env.CLICKHOUSE_PORT || "8443";
const DB = process.env.CLICKHOUSE_SCHEMA || "janis_datawarehouse_masonline";
const auth = "Basic " + Buffer.from((process.env.CH_USER || process.env.CLICKHOUSE_USER) + ":" + (process.env.CH_PASS || process.env.CLICKHOUSE_PASSWORD)).toString("base64");
// Ventana de días a recalcular. Chico = menos lectura = respeta la cuota de ClickHouse (~5GB/día).
// 3 = ayer + hoy + margen. Subir con cuidado.
const DIAS = Number(process.env.ETL_DIAS || 3);

function q(sql) {
  return new Promise((res, rej) => {
    const req = https.request(
      { host: HOST, port: PORT, method: "POST", path: "/", headers: { Authorization: auth }, rejectUnauthorized: false, timeout: 120000 },
      (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => (r.statusCode === 200 ? res(d) : rej(new Error("HTTP " + r.statusCode + ": " + d.slice(0, 300))))); }
    );
    req.on("error", rej);
    req.on("timeout", () => { req.destroy(); rej(new Error("timeout")); });
    req.end(sql + "\nFORMAT JSONEachRow");
  });
}
const rows = async (sql) => (await q(sql)).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

// CTE reutilizable: location_id -> cod_tienda (reference_id) + nombre
const LOCMAP = `locmap AS (SELECT location_id, argMax(reference_id,date_modified) cod, argMax(location_name,date_modified) nombre FROM ${DB}.locations GROUP BY location_id)`;

(async () => {
  console.log("ETL snapshot · DB=" + DB + " · " + HOST);

  // ── VENTAS (por día de creación, por tienda) ──
  const ventas = await rows(`WITH ${LOCMAP},
    o AS (SELECT order_id, toDate(argMax(date_created,date_modified)) dia, argMax(total_amount,date_modified) t, argMax(shipping_location_id,date_modified) sloc
          FROM ${DB}.orders WHERE date_created >= today()-${DIAS + 1} GROUP BY order_id)
    SELECT toString(o.dia) dia, loc.cod cod, count() pedidos, round(sum(o.t)) venta
    FROM o LEFT JOIN locmap loc ON loc.location_id=o.sloc
    WHERE o.dia >= today()-${DIAS} GROUP BY dia, cod`);

  // ── SKUs distintos (por día creación, por tienda) ──
  const skus = await rows(`WITH ${LOCMAP}
    SELECT toString(toDate(oi.date_created)) dia, loc.cod cod, uniqExact(oi.sku_commerce_id) skus
    FROM ${DB}.order_items oi LEFT JOIN locmap loc ON loc.location_id=oi.location_id
    WHERE oi.date_created >= today()-${DIAS} AND oi.is_removed=false GROUP BY dia, cod`);

  // ── HORAS creación→entrega (por día creación, por tienda) ──
  const horas = await rows(`WITH ${LOCMAP},
    o AS (SELECT order_id, argMax(date_created,date_modified) cr, toDate(argMax(date_created,date_modified)) dia, argMax(shipping_location_id,date_modified) sloc
          FROM ${DB}.orders WHERE date_created >= today()-${DIAS + 1} GROUP BY order_id),
    d AS (SELECT order_id, max(step_date_end) en FROM ${DB}.order_steps WHERE step_name='delivery' AND step_status='finished' GROUP BY order_id)
    SELECT toString(o.dia) dia, loc.cod cod, sum(dateDiff('hour',o.cr,d.en)) horas_sum, count() horas_cnt
    FROM o INNER JOIN d ON d.order_id=o.order_id LEFT JOIN locmap loc ON loc.location_id=o.sloc
    WHERE o.dia >= today()-${DIAS} GROUP BY dia, cod`);

  // ── GESTIÓN (por día de ENTREGA programada, por tienda) ──
  const gestion = await rows(`WITH ${LOCMAP},
    base AS (SELECT order_id oid, argMax(status_code,date_modified) estado, toDate(argMax(delivery_sla_end,date_modified)) dia, argMax(shipping_location_id,date_modified) sloc
             FROM ${DB}.orders WHERE delivery_sla_end >= today()-${DIAS + 1} GROUP BY order_id),
    inv AS (SELECT DISTINCT order_id FROM ${DB}.order_invoices WHERE date_created >= today()-${DIAS + 3})
    SELECT toString(base.dia) dia, loc.cod cod, count() total,
      countIf(estado='delivered') entregado,
      countIf(estado='canceled' OR estado='cancelationRequested') cancelado,
      countIf(estado='notDelivered') no_entregado,
      countIf(estado='needsRescheduling') postergado,
      countIf(estado NOT IN ('delivered','canceled','cancelationRequested','notDelivered','needsRescheduling')) pendiente,
      countIf(inv.order_id != '') facturado
    FROM base LEFT JOIN locmap loc ON loc.location_id=base.sloc LEFT JOIN inv ON inv.order_id=base.oid
    WHERE base.dia >= today()-${DIAS} GROUP BY dia, cod`);

  // ── CANAL (por día entrega, por tienda, por canal) ──
  const canal = await rows(`WITH ${LOCMAP},
    o AS (SELECT order_id, toDate(argMax(delivery_sla_end,date_modified)) dia, argMax(shipping_location_id,date_modified) sloc, argMax(if(shipping_type='','sin_dato',shipping_type),date_modified) canal
          FROM ${DB}.orders WHERE delivery_sla_end >= today()-${DIAS + 1} GROUP BY order_id)
    SELECT toString(o.dia) dia, loc.cod cod, o.canal canal, count() n
    FROM o LEFT JOIN locmap loc ON loc.location_id=o.sloc WHERE o.dia >= today()-${DIAS} GROUP BY dia, cod, canal`);

  // ── ANTIGÜEDAD (por día entrega, por tienda, por edad) ──
  const antig = await rows(`WITH ${LOCMAP},
    o AS (SELECT order_id, toDate(argMax(delivery_sla_end,date_modified)) dia, argMax(shipping_location_id,date_modified) sloc,
                 dateDiff('day', toDate(argMax(date_created,date_modified)), toDate(argMax(delivery_sla_end,date_modified))) edad
          FROM ${DB}.orders WHERE delivery_sla_end >= today()-${DIAS + 1} GROUP BY order_id)
    SELECT toString(o.dia) dia, loc.cod cod, o.edad edad, count() n
    FROM o LEFT JOIN locmap loc ON loc.location_id=o.sloc WHERE o.dia >= today()-${DIAS} AND o.edad >= 0 GROUP BY dia, cod, edad`);

  // ── Merge a estructura por dia -> cod ──
  const snap = { generatedAt: new Date().toISOString(), dias: [], ventas: {}, gestion: {} };
  const put = (obj, dia, cod) => { obj[dia] = obj[dia] || {}; obj[dia][cod] = obj[dia][cod] || {}; return obj[dia][cod]; };

  ventas.forEach((r) => { const c = put(snap.ventas, r.dia, r.cod || "?"); c.pedidos = Number(r.pedidos); c.venta = Number(r.venta) || 0; });
  skus.forEach((r) => { const c = put(snap.ventas, r.dia, r.cod || "?"); c.skus = Number(r.skus); });
  horas.forEach((r) => { const c = put(snap.ventas, r.dia, r.cod || "?"); c.horas_sum = Number(r.horas_sum) || 0; c.horas_cnt = Number(r.horas_cnt) || 0; });
  gestion.forEach((r) => { const c = put(snap.gestion, r.dia, r.cod || "?"); Object.assign(c, { total: +r.total, entregado: +r.entregado, pendiente: +r.pendiente, cancelado: +r.cancelado, postergado: +r.postergado, no_entregado: +r.no_entregado, facturado: +r.facturado }); });
  canal.forEach((r) => { const c = put(snap.gestion, r.dia, r.cod || "?"); c.canal = c.canal || {}; c.canal[r.canal] = Number(r.n); });
  antig.forEach((r) => { const c = put(snap.gestion, r.dia, r.cod || "?"); c.antig = c.antig || {}; c.antig[r.edad] = Number(r.n); });

  snap.dias = Array.from(new Set([...Object.keys(snap.ventas), ...Object.keys(snap.gestion)])).sort().reverse();

  const out = path.join(__dirname, "..", "public", "data", "snapshot.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(snap), "utf8");
  console.log(`OK -> ${out}  (días: ${snap.dias.join(", ")})`);
})().catch((e) => { console.error("ETL ERROR:", e.message); process.exit(1); });

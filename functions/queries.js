"use strict";

/**
 * Registro de queries NOMBRADAS y parametrizadas.
 *
 * El frontend NO envía SQL: envía un `queryId` y parámetros acotados
 * (fecha, tiendas). Acá se traduce a SQL seguro del lado servidor.
 *
 * Parámetros comunes:
 *   - fecha: "YYYY-MM-DD" (validado). Si falta -> ayer (today()-1).
 *   - tiendas: array de códigos de tienda (locations.reference_id).
 *              Si vacío -> todas. Filtra por región (la región la arma el front).
 */

const DB = process.env.CLICKHOUSE_SCHEMA || "janis_datawarehouse_masonline";

// ── Helpers de seguridad ──────────────────────────────────────
function fechaExpr(fecha) {
  if (typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return `toDate('${fecha}')`;
  }
  return "today() - 1"; // default: ayer
}

function tiendasParam(tiendas) {
  if (!Array.isArray(tiendas)) return [];
  // solo strings/numeros simples
  return tiendas.map((t) => String(t)).filter((t) => /^[\w.\-]{1,40}$/.test(t));
}

// Filtro de tienda para orders (vía shipping_location_id -> locations.reference_id)
function sfOrders(tiendas) {
  return tiendas.length
    ? `AND shipping_location_id IN (SELECT location_id FROM ${DB}.locations WHERE reference_id IN {tiendas:Array(String)})`
    : "";
}
// Filtro de tienda para order_items (vía location_id)
function sfItems(tiendas) {
  return tiendas.length
    ? `AND location_id IN (SELECT location_id FROM ${DB}.locations WHERE reference_id IN {tiendas:Array(String)})`
    : "";
}

// ── Queries ───────────────────────────────────────────────────
const QUERIES = {
  /**
   * Resumen de VENTAS del día (por fecha de creación/venta).
   * Devuelve 1 fila: pedidos, venta_pesos, ticket_promedio, skus_distintos, prom_horas_entrega.
   */
  ventas_resumen: {
    description:
      "Ventas del día (fecha = creación del pedido). pedidos=count pedidos · venta_pesos=Σ orders.total_amount · skus_distintos=order_items.sku_commerce_id únicos · prom_horas_entrega=avg horas creación→entrega real (order_steps delivery finished).",
    build: (p) => {
      const tiendas = tiendasParam(p.tiendas);
      const F = fechaExpr(p.fecha);
      const sql = `
        SELECT
          (SELECT count() FROM (
             SELECT order_id FROM ${DB}.orders
             WHERE toDate(date_created) = ${F} ${sfOrders(tiendas)} GROUP BY order_id)) AS pedidos,
          (SELECT round(sum(t)) FROM (
             SELECT argMax(total_amount, date_modified) t FROM ${DB}.orders
             WHERE toDate(date_created) = ${F} ${sfOrders(tiendas)} GROUP BY order_id)) AS venta_pesos,
          (SELECT round(avg(t)) FROM (
             SELECT argMax(total_amount, date_modified) t FROM ${DB}.orders
             WHERE toDate(date_created) = ${F} ${sfOrders(tiendas)} GROUP BY order_id)) AS ticket_promedio,
          (SELECT uniqExact(sku_commerce_id) FROM ${DB}.order_items
             WHERE toDate(date_created) = ${F} AND is_removed = false ${sfItems(tiendas)}) AS skus_distintos,
          (SELECT round(avg(dateDiff('hour', d.cr, s.en)), 1) FROM
             (SELECT order_id, argMax(date_created, date_modified) cr FROM ${DB}.orders
                WHERE toDate(date_created) = ${F} ${sfOrders(tiendas)} GROUP BY order_id) d
             INNER JOIN (SELECT order_id, max(step_date_end) en FROM ${DB}.order_steps
                WHERE step_name = 'delivery' AND step_status = 'finished' GROUP BY order_id) s
             ON s.order_id = d.order_id) AS prom_horas_entrega
      `;
      return { sql, params: tiendas.length ? { tiendas } : {} };
    },
  },

  /**
   * Resumen de GESTIÓN del día cerrado (por fecha de ENTREGA programada).
   * Devuelve 1 fila con los buckets de estado + facturados.
   */
  gestion_resumen: {
    description:
      "Gestión del día (fecha = entrega programada, orders.delivery_sla_end). entregado=delivered · cancelado=canceled/cancelationRequested · no_entregado=notDelivered · postergado=needsRescheduling · pendiente=resto · facturados=pedidos con order_invoices.",
    build: (p) => {
      const tiendas = tiendasParam(p.tiendas);
      const F = fechaExpr(p.fecha);
      const sql = `
        WITH base AS (
          SELECT o.order_id AS oid, argMax(o.status_code, o.date_modified) AS estado
          FROM ${DB}.orders o
          WHERE toDate(o.delivery_sla_end) = ${F} ${sfOrders(tiendas)}
          GROUP BY o.order_id
        )
        SELECT
          count() AS pedidos,
          countIf(estado = 'delivered') AS entregado,
          countIf(estado = 'canceled' OR estado = 'cancelationRequested') AS cancelado,
          countIf(estado = 'notDelivered') AS no_entregado,
          countIf(estado = 'needsRescheduling') AS postergado,
          countIf(estado NOT IN ('delivered','canceled','cancelationRequested','notDelivered','needsRescheduling')) AS pendiente,
          (SELECT uniqExact(order_id) FROM ${DB}.order_invoices
             WHERE toDate(date_created) >= ${F} - 3 AND order_id IN (SELECT oid FROM base)) AS facturados
        FROM base
      `;
      return { sql, params: tiendas.length ? { tiendas } : {} };
    },
  },

  /**
   * Desglose de ANTIGÜEDAD (drill-down): de los pedidos con entrega = fecha,
   * cuántos se crearon hace 0,1,2... días, + promedio.
   */
  gestion_antiguedad: {
    description:
      "Drill-down: de los pedidos con entrega programada = fecha, desglose por días entre creación y entrega (0 = mismo día). prom_dias = promedio.",
    build: (p) => {
      const tiendas = tiendasParam(p.tiendas);
      const F = fechaExpr(p.fecha);
      const sql = `
        SELECT dias_antiguedad, count() AS pedidos
        FROM (
          SELECT dateDiff('day', toDate(argMax(date_created, date_modified)), ${F}) AS dias_antiguedad
          FROM ${DB}.orders
          WHERE toDate(delivery_sla_end) = ${F} ${sfOrders(tiendas)}
          GROUP BY order_id
        )
        WHERE dias_antiguedad >= 0
        GROUP BY dias_antiguedad
        ORDER BY dias_antiguedad
        LIMIT 60
      `;
      return { sql, params: tiendas.length ? { tiendas } : {} };
    },
  },

  /**
   * Distribución por CANAL de entrega (tipo de envío) para entrega = fecha.
   */
  gestion_por_canal: {
    description:
      "Canal/tipo de entrega de los pedidos con entrega programada = fecha (orders.shipping_type).",
    build: (p) => {
      const tiendas = tiendasParam(p.tiendas);
      const F = fechaExpr(p.fecha);
      const sql = `
        SELECT canal, count() AS pedidos FROM (
          SELECT order_id, argMax(if(shipping_type = '', 'sin_dato', shipping_type), date_modified) AS canal
          FROM ${DB}.orders
          WHERE toDate(delivery_sla_end) = ${F} ${sfOrders(tiendas)}
          GROUP BY order_id
        )
        GROUP BY canal ORDER BY pedidos DESC
      `;
      return { sql, params: tiendas.length ? { tiendas } : {} };
    },
  },

  /**
   * Gestión POR TIENDA (para armar la tabla por región en el front).
   * Devuelve por tienda: total, entregado, pendiente, cancelado, % entregado.
   */
  gestion_por_tienda: {
    description:
      "Por tienda (entrega = fecha): cod_tienda, tienda, total, entregado, pendiente, cancelado, pct_entregado. El front agrupa por región.",
    build: (p) => {
      const tiendas = tiendasParam(p.tiendas);
      const F = fechaExpr(p.fecha);
      const sql = `
        WITH base AS (
          SELECT o.order_id AS oid,
                 argMax(o.status_code, o.date_modified) AS estado,
                 argMax(o.shipping_location_id, o.date_modified) AS sloc
          FROM ${DB}.orders o
          WHERE toDate(o.delivery_sla_end) = ${F} ${sfOrders(tiendas)}
          GROUP BY o.order_id
        ),
        locmap AS (
          SELECT location_id, argMax(reference_id, date_modified) AS cod_tienda,
                 argMax(location_name, date_modified) AS tienda
          FROM ${DB}.locations GROUP BY location_id
        )
        SELECT
          loc.cod_tienda AS cod_tienda,
          loc.tienda     AS tienda,
          count()        AS total,
          countIf(estado = 'delivered') AS entregado,
          countIf(estado = 'canceled' OR estado = 'cancelationRequested') AS cancelado,
          countIf(estado NOT IN ('delivered','canceled','cancelationRequested','notDelivered','needsRescheduling')) AS pendiente,
          round(100 * countIf(estado = 'delivered') / count(), 1) AS pct_entregado
        FROM base
        LEFT JOIN locmap AS loc ON loc.location_id = base.sloc
        GROUP BY cod_tienda, tienda
        ORDER BY total DESC
      `;
      return { sql, params: tiendas.length ? { tiendas } : {} };
    },
  },

  /**
   * Productos NO ENCONTRADOS / REEMPLAZADOS en picking (tienda, SKU, horario, estado).
   */
  productos_no_encontrados: {
    description:
      "Productos no encontrados/reemplazados en picking (tienda, SKU, horario de búsqueda, estado). Param: dias (ventana, default 1).",
    build: (p) => {
      const dias = Number.isInteger(p.dias) && p.dias > 0 && p.dias <= 30 ? p.dias : 1;
      const sql = `
        WITH busqueda AS (
          SELECT order_item_id, max(time_tracking_time) AS horario
          FROM ${DB}.item_picking_time_tracking
          WHERE time_tracking_type = 'finish' AND date_created >= now() - INTERVAL ${dias} DAY
          GROUP BY order_item_id
        ),
        reemplazos AS (
          SELECT DISTINCT order_item_id FROM ${DB}.order_item_picking_results
          WHERE is_substitute = true AND date_created >= now() - INTERVAL ${dias} DAY
        ),
        pick AS (
          SELECT order_id, max(picking_id) AS picking_id, max(date_created) AS fecha_picking
          FROM ${DB}.order_picking WHERE date_created >= now() - INTERVAL ${dias + 2} DAY GROUP BY order_id
        ),
        ped AS (
          SELECT order_id, argMax(status_code, date_modified) AS estado_pedido
          FROM ${DB}.orders WHERE date_created >= now() - INTERVAL ${dias + 2} DAY GROUP BY order_id
        )
        SELECT DISTINCT
          loc.location_name AS tienda, loc.reference_id AS cod_tienda, loc.address_city AS ciudad,
          oi.item_id AS id_item, oi.sku_commerce_id AS sku, oi.ean_code AS ean, oi.item_name AS producto,
          p.picking_id AS id_picking, p.fecha_picking AS fecha_picking, b.horario AS horario_busqueda,
          pe.estado_pedido AS estado_pedido,
          if(r.order_item_id != '', 'REEMPLAZADO', 'NO ENCONTRADO') AS estado_item, oi.order_id AS pedido
        FROM ${DB}.order_items AS oi
        INNER JOIN busqueda AS b ON b.order_item_id = oi.item_id
        LEFT JOIN ${DB}.locations AS loc ON loc.location_id = oi.location_id
        LEFT JOIN reemplazos AS r ON r.order_item_id = oi.item_id
        LEFT JOIN pick AS p ON p.order_id = oi.order_id
        LEFT JOIN ped AS pe ON pe.order_id = oi.order_id
        WHERE oi.date_created >= now() - INTERVAL ${dias + 2} DAY AND oi.is_picked = false
        ORDER BY horario_busqueda DESC LIMIT 5000
      `;
      return { sql, params: {} };
    },
  },
};

function resolveQuery(queryId, clientParams = {}) {
  const def = QUERIES[queryId];
  if (!def) throw new Error(`queryId desconocido: ${queryId}`);
  return def.build(clientParams || {});
}

function listQueries() {
  return Object.entries(QUERIES).map(([id, q]) => ({ id, description: q.description }));
}

module.exports = { QUERIES, resolveQuery, listQueries };

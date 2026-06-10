"use strict";

/**
 * Registro de queries NOMBRADAS y parametrizadas.
 *
 * Por seguridad, el frontend NO envía SQL: envía un `queryId` y parámetros
 * acotados. Acá se traduce a SQL del lado servidor. Esto evita inyección
 * y exfiltración de datos.
 *
 * El esquema (datalake) viene de env, no del cliente.
 */

const SCHEMA = process.env.CLICKHOUSE_SCHEMA || "datalake";

const QUERIES = {
  /**
   * Productos NO ENCONTRADOS o REEMPLAZADOS en el picking.
   * Devuelve: tienda, código, ciudad, id ítem, SKU, EAN, producto,
   * id/fecha de picking, horario de búsqueda, estado del pedido y del ítem.
   * Param: dias (ventana de búsqueda, default 1).
   */
  productos_no_encontrados: {
    description:
      "Productos no encontrados/reemplazados en picking (tienda, SKU, horario, estado).",
    params: { dias: { type: "UInt8", default: 1 } },
    build: () => `
      WITH busqueda AS (
        SELECT order_item_id, max(time_tracking_time) AS horario
        FROM ${SCHEMA}.item_picking_time_tracking
        WHERE time_tracking_type = 'finish'
          AND date_created >= now() - INTERVAL {dias:UInt8} DAY
        GROUP BY order_item_id
      ),
      reemplazos AS (
        SELECT DISTINCT order_item_id
        FROM ${SCHEMA}.order_item_picking_results
        WHERE is_substitute = true
          AND date_created >= now() - INTERVAL {dias:UInt8} DAY
      ),
      pick AS (
        SELECT order_id, max(picking_id) AS picking_id, max(date_created) AS fecha_picking
        FROM ${SCHEMA}.order_picking
        WHERE date_created >= now() - INTERVAL ({dias:UInt8} + 2) DAY
        GROUP BY order_id
      ),
      ped AS (
        SELECT order_id, argMax(status_code, date_modified) AS estado_pedido
        FROM ${SCHEMA}.orders
        WHERE date_created >= now() - INTERVAL ({dias:UInt8} + 2) DAY
        GROUP BY order_id
      )
      SELECT DISTINCT
        loc.location_name  AS tienda,
        loc.reference_id   AS cod_tienda,
        loc.address_city   AS ciudad,
        oi.item_id         AS id_item,
        oi.sku_commerce_id AS sku,
        oi.ean_code        AS ean,
        oi.item_name       AS producto,
        p.picking_id       AS id_picking,
        p.fecha_picking    AS fecha_picking,
        b.horario          AS horario_busqueda,
        pe.estado_pedido   AS estado_pedido,
        if(r.order_item_id != '', 'REEMPLAZADO', 'NO ENCONTRADO') AS estado_item,
        oi.order_id        AS pedido
      FROM ${SCHEMA}.order_items AS oi
      INNER JOIN busqueda   AS b   ON b.order_item_id = oi.item_id
      LEFT  JOIN ${SCHEMA}.locations AS loc ON loc.location_id = oi.location_id
      LEFT  JOIN reemplazos AS r   ON r.order_item_id = oi.item_id
      LEFT  JOIN pick       AS p   ON p.order_id      = oi.order_id
      LEFT  JOIN ped        AS pe  ON pe.order_id     = oi.order_id
      WHERE oi.date_created >= now() - INTERVAL ({dias:UInt8} + 2) DAY
        AND oi.is_picked = false
      ORDER BY horario_busqueda DESC
      LIMIT 5000
    `,
  },
};

/**
 * Resuelve un queryId + params del cliente a { sql, params } seguros.
 */
function resolveQuery(queryId, clientParams = {}) {
  const def = QUERIES[queryId];
  if (!def) {
    throw new Error(`queryId desconocido: ${queryId}`);
  }
  const params = {};
  for (const [name, spec] of Object.entries(def.params || {})) {
    const v = clientParams[name];
    params[name] = v === undefined || v === null ? spec.default : v;
  }
  return { sql: def.build(params), params };
}

function listQueries() {
  return Object.entries(QUERIES).map(([id, q]) => ({
    id,
    description: q.description,
    params: q.params,
  }));
}

module.exports = { QUERIES, resolveQuery, listQueries };

"use strict";

const { createClient } = require("@clickhouse/client");

/**
 * Crea un cliente de ClickHouse usando las variables de entorno.
 * Las credenciales NUNCA están en el código: vienen de .env (local) o
 * de los secrets de Firebase Functions (producción).
 */
function getClient() {
  const host = process.env.CLICKHOUSE_HOST;
  const port = process.env.CLICKHOUSE_PORT || "8443";
  const protocol = process.env.CLICKHOUSE_PROTOCOL || "https";
  const username = process.env.CLICKHOUSE_USER;
  const password = process.env.CLICKHOUSE_PASSWORD;
  const database = process.env.CLICKHOUSE_DATABASE || "default";

  if (!host || !username || !password) {
    throw new Error(
      "Faltan credenciales de ClickHouse (CLICKHOUSE_HOST/USER/PASSWORD)."
    );
  }

  return createClient({
    url: `${protocol}://${host}:${port}`,
    username,
    password,
    database,
    request_timeout: 90000,
  });
}

/**
 * Ejecuta una query parametrizada y devuelve las filas como JSON.
 * @param {string} sql  SQL con placeholders {nombre:Tipo}
 * @param {object} params  valores de los placeholders
 */
async function query(sql, params = {}) {
  const client = getClient();
  try {
    const resultSet = await client.query({
      query: sql,
      query_params: params,
      format: "JSONEachRow",
    });
    return await resultSet.json();
  } finally {
    await client.close();
  }
}

module.exports = { getClient, query };

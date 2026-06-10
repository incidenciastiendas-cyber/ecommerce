"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

const { query } = require("./clickhouse");
const { resolveQuery, listQueries } = require("./queries");

// El password de ClickHouse se guarda como SECRET en Firebase, nunca en código.
// Setear con:  firebase functions:secrets:set CLICKHOUSE_PASSWORD
const CLICKHOUSE_PASSWORD = defineSecret("CLICKHOUSE_PASSWORD");

const REGION = "southamerica-east1"; // São Paulo, baja latencia para AR
const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || "gdnargentina.com";

/**
 * Valida que el llamado venga de un usuario logueado, con email verificado
 * y del dominio permitido. Lanza HttpsError si no cumple.
 */
function assertAllowed(request) {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "Tenés que iniciar sesión.");
  }
  const token = auth.token || {};
  const email = (token.email || "").toLowerCase();
  if (!token.email_verified) {
    throw new HttpsError("permission-denied", "Email no verificado.");
  }
  if (!email.endsWith("@" + ALLOWED_DOMAIN)) {
    logger.warn(`Acceso denegado a ${email} (dominio no permitido)`);
    throw new HttpsError(
      "permission-denied",
      `Acceso restringido a cuentas @${ALLOWED_DOMAIN}.`
    );
  }
  return email;
}

const callOpts = {
  region: REGION,
  secrets: [CLICKHOUSE_PASSWORD],
  cors: true,
  memory: "512MiB",
  timeoutSeconds: 120,
};

/**
 * Ejecuta una query nombrada del registro (no acepta SQL crudo del cliente).
 * data: { queryId: string, params?: object }
 */
exports.runQuery = onCall(callOpts, async (request) => {
  const email = assertAllowed(request);
  const { queryId, params } = request.data || {};

  if (!queryId || typeof queryId !== "string") {
    throw new HttpsError("invalid-argument", "Falta queryId.");
  }

  let resolved;
  try {
    resolved = resolveQuery(queryId, params || {});
  } catch (e) {
    throw new HttpsError("invalid-argument", e.message);
  }

  try {
    const t0 = Date.now();
    const rows = await query(resolved.sql, resolved.params);
    logger.info(
      `runQuery ${queryId} por ${email}: ${rows.length} filas en ${
        Date.now() - t0
      }ms`
    );
    return { rows, count: rows.length };
  } catch (e) {
    logger.error(`Error en runQuery ${queryId}:`, e);
    throw new HttpsError("internal", "Error al consultar el data lake.");
  }
});

/**
 * Lista las queries disponibles (para que el dashboard arme los menús).
 */
exports.listAvailableQueries = onCall(
  { region: REGION, cors: true },
  async (request) => {
    assertAllowed(request);
    return { queries: listQueries() };
  }
);

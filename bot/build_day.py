#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────
#  Bot ETL — arma el JSON de indicadores de UN día (por tienda).
#  Pipeline:
#    - "cierre"   (1 vez/día, tras medianoche): día cerrado = AYER  -> archivo definitivo
#    - "intradia" (cada 30-60 min):             día en curso = HOY   -> se pisa
#  Lee POCO de ClickHouse (un solo día) para respetar la cuota (~5GB/día).
#  Sin dependencias externas (solo stdlib).
#
#  Uso:
#    CH_USER=.. CH_PASS=.. python bot/build_day.py cierre
#    CH_USER=.. CH_PASS=.. python bot/build_day.py intradia
#    CH_USER=.. CH_PASS=.. python bot/build_day.py 2026-06-09   (fecha explícita)
#
#  Salida:
#    public/data/dias/<fecha>.json   (datos del día, por tienda)
#    public/data/index.json          (lista de días disponibles)
# ─────────────────────────────────────────────────────────────
import os, sys, ssl, json, base64, urllib.request, datetime, re
from pathlib import Path

HOST = os.environ.get("CLICKHOUSE_HOST", "quantics.data-lake.janis.in")
PORT = os.environ.get("CLICKHOUSE_PORT", "8443")
DB   = os.environ.get("CLICKHOUSE_SCHEMA", "janis_datawarehouse_masonline")
USER = os.environ.get("CH_USER") or os.environ.get("CLICKHOUSE_USER")
PASS = os.environ.get("CH_PASS") or os.environ.get("CLICKHOUSE_PASSWORD")

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "public" / "data"
DIAS_DIR = DATA_DIR / "dias"

_ctx = ssl.create_default_context()
_ctx.check_hostname = False
_ctx.verify_mode = ssl.CERT_NONE

def q(sql):
    body = (sql + "\nFORMAT JSONEachRow").encode("utf-8")
    req = urllib.request.Request(f"https://{HOST}:{PORT}/", data=body)
    req.add_header("Authorization", "Basic " + base64.b64encode(f"{USER}:{PASS}".encode()).decode())
    with urllib.request.urlopen(req, context=_ctx, timeout=180) as r:
        txt = r.read().decode("utf-8")
    return [json.loads(l) for l in txt.splitlines() if l.strip()]

LOCMAP = (f"locmap AS (SELECT location_id, argMax(reference_id,date_modified) cod, "
          f"argMax(location_name,date_modified) nombre FROM {DB}.locations GROUP BY location_id)")

ESTADOS_NO_TERMINALES = "estado NOT IN ('delivered','canceled','cancelationRequested','notDelivered','needsRescheduling')"

def server_date(offset_days=0):
    return q(f"SELECT toString(today() - {int(offset_days)}) v")[0]["v"]

def build(fecha):
    assert re.match(r"^\d{4}-\d{2}-\d{2}$", fecha), "fecha inválida"
    F = f"toDate('{fecha}')"
    out = {"fecha": fecha, "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "ventas": {}, "gestion": {}}

    def ven(cod): out["ventas"].setdefault(cod or "?", {})
    def ges(cod): out["gestion"].setdefault(cod or "?", {})

    # ── VENTAS (creados = fecha) ──
    for r in q(f"""WITH {LOCMAP},
        o AS (SELECT order_id, argMax(total_amount,date_modified) t, argMax(shipping_location_id,date_modified) sloc
              FROM {DB}.orders WHERE toDate(date_created)={F} GROUP BY order_id)
        SELECT loc.cod cod, count() pedidos, round(sum(o.t)) venta
        FROM o LEFT JOIN locmap loc ON loc.location_id=o.sloc GROUP BY cod"""):
        c = out["ventas"].setdefault(r["cod"] or "?", {}); c["pedidos"] = int(r["pedidos"]); c["venta"] = int(r["venta"] or 0)

    for r in q(f"""WITH {LOCMAP}
        SELECT loc.cod cod, uniqExact(sku_commerce_id) skus
        FROM {DB}.order_items oi LEFT JOIN locmap loc ON loc.location_id=oi.location_id
        WHERE toDate(oi.date_created)={F} AND oi.is_removed=false GROUP BY cod"""):
        out["ventas"].setdefault(r["cod"] or "?", {})["skus"] = int(r["skus"])

    for r in q(f"""WITH {LOCMAP},
        o AS (SELECT order_id, argMax(date_created,date_modified) cr, argMax(shipping_location_id,date_modified) sloc
              FROM {DB}.orders WHERE toDate(date_created)={F} GROUP BY order_id),
        d AS (SELECT order_id, max(step_date_end) en FROM {DB}.order_steps
              WHERE step_name='delivery' AND step_status='finished' AND step_date_end >= {F} GROUP BY order_id)
        SELECT loc.cod cod, sum(dateDiff('hour',o.cr,d.en)) horas_sum, count() horas_cnt
        FROM o INNER JOIN d ON d.order_id=o.order_id LEFT JOIN locmap loc ON loc.location_id=o.sloc GROUP BY cod"""):
        c = out["ventas"].setdefault(r["cod"] or "?", {}); c["horas_sum"] = int(r["horas_sum"] or 0); c["horas_cnt"] = int(r["horas_cnt"] or 0)

    # ── GESTIÓN (entrega programada = fecha) ──
    for r in q(f"""WITH {LOCMAP},
        base AS (SELECT order_id oid, argMax(status_code,date_modified) estado, argMax(shipping_location_id,date_modified) sloc
                 FROM {DB}.orders WHERE toDate(delivery_sla_end)={F} AND date_created >= {F}-25 AND date_created <= {F}+2 GROUP BY order_id),
        inv AS (SELECT DISTINCT order_id FROM {DB}.order_invoices WHERE date_created >= {F}-25)
        SELECT loc.cod cod, count() total,
          countIf(estado='delivered') entregado,
          countIf(estado='canceled' OR estado='cancelationRequested') cancelado,
          countIf(estado='notDelivered') no_entregado,
          countIf(estado='needsRescheduling') postergado,
          countIf({ESTADOS_NO_TERMINALES}) pendiente,
          countIf(inv.order_id != '') facturado
        FROM base LEFT JOIN locmap loc ON loc.location_id=base.sloc LEFT JOIN inv ON inv.order_id=base.oid GROUP BY cod"""):
        c = out["gestion"].setdefault(r["cod"] or "?", {})
        for k in ("total", "entregado", "cancelado", "no_entregado", "postergado", "pendiente", "facturado"):
            c[k] = int(r[k])

    for r in q(f"""WITH {LOCMAP},
        o AS (SELECT order_id, argMax(shipping_location_id,date_modified) sloc, argMax(if(shipping_type='','sin_dato',shipping_type),date_modified) canal
              FROM {DB}.orders WHERE toDate(delivery_sla_end)={F} AND date_created >= {F}-25 GROUP BY order_id)
        SELECT loc.cod cod, o.canal canal, count() n FROM o LEFT JOIN locmap loc ON loc.location_id=o.sloc GROUP BY cod, canal"""):
        c = out["gestion"].setdefault(r["cod"] or "?", {}); c.setdefault("canal", {})[r["canal"]] = int(r["n"])

    for r in q(f"""WITH {LOCMAP},
        o AS (SELECT order_id, argMax(shipping_location_id,date_modified) sloc,
                     dateDiff('day', toDate(argMax(date_created,date_modified)), {F}) edad
              FROM {DB}.orders WHERE toDate(delivery_sla_end)={F} AND date_created >= {F}-25 GROUP BY order_id)
        SELECT loc.cod cod, o.edad edad, count() n FROM o LEFT JOIN locmap loc ON loc.location_id=o.sloc
        WHERE o.edad >= 0 GROUP BY cod, edad"""):
        c = out["gestion"].setdefault(r["cod"] or "?", {}); c.setdefault("antig", {})[str(r["edad"])] = int(r["n"])

    return out

def save(out):
    DIAS_DIR.mkdir(parents=True, exist_ok=True)
    (DIAS_DIR / f"{out['fecha']}.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    # index.json (días disponibles a partir de los archivos)
    dias = sorted({p.stem for p in DIAS_DIR.glob("*.json")}, reverse=True)
    idx = {"dias": dias, "latest": dias[0] if dias else None,
           "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    (DATA_DIR / "index.json").write_text(json.dumps(idx, ensure_ascii=False), encoding="utf-8")
    print(f"OK -> dias/{out['fecha']}.json  (tiendas ventas={len(out['ventas'])}, gestion={len(out['gestion'])})  index: {len(dias)} días")

def main():
    if not USER or not PASS:
        print("ERROR: faltan credenciales (CH_USER / CH_PASS)"); sys.exit(1)
    mode = sys.argv[1] if len(sys.argv) > 1 else "intradia"
    if re.match(r"^\d{4}-\d{2}-\d{2}$", mode):
        fecha = mode
    elif mode == "cierre":
        fecha = server_date(1)   # ayer
    else:
        fecha = server_date(0)   # hoy
    print(f"Bot · modo={mode} · fecha={fecha} · DB={DB}")
    save(build(fecha))

if __name__ == "__main__":
    main()

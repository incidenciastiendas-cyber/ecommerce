#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────
#  Bot ETL — Dashboard Operativo E-Commerce (réplica MasOnline)
#  Calcula la SEMANA (lunes→ayer) por tienda y coordinador, +daily.
#  KPIs: Venta, Pedidos, Ticket, Mix HD/RT/DT, OT Preparación,
#        OT Delivery, Fillrate, % Faltantes, Reprogramaciones, VS LW.
#  Tienda identificada por shipping_polygon_name (TIPO-NUMERO -> NUMERO).
#  Criterio de fecha: semanal=shipping_dispatch_date, diario=commerce_date_created.
#  Sin dependencias externas (solo stdlib).
#
#  Uso:  CH_USER=.. CH_PASS=.. python bot/build_snapshot.py [light]
#        light = omite OT/Fillrate (joins pesados) y preserva los del snapshot previo.
#  Salida: public/data/snapshot.json
# ─────────────────────────────────────────────────────────────
import os, sys, ssl, json, base64, urllib.request, re
from pathlib import Path
from datetime import date, timedelta, datetime, timezone

HOST = os.environ.get("CLICKHOUSE_HOST", "quantics.data-lake.janis.in")
PORT = os.environ.get("CLICKHOUSE_PORT", "8443")
DB   = os.environ.get("CLICKHOUSE_SCHEMA", "janis_datawarehouse_masonline")
USER = os.environ.get("CH_USER") or os.environ.get("CLICKHOUSE_USER")
PASS = os.environ.get("CH_PASS") or os.environ.get("CLICKHOUSE_PASSWORD")
LIGHT = "light" in sys.argv

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
OUT = DATA / "snapshot.json"
MASTER = json.loads((DATA / "tiendas-master.json").read_text(encoding="utf-8"))

_ctx = ssl.create_default_context(); _ctx.check_hostname = False; _ctx.verify_mode = ssl.CERT_NONE
def q(sql):
    body = (sql + "\nFORMAT JSONEachRow").encode("utf-8")
    req = urllib.request.Request(f"https://{HOST}:{PORT}/", data=body)
    req.add_header("Authorization", "Basic " + base64.b64encode(f"{USER}:{PASS}".encode()).decode())
    with urllib.request.urlopen(req, context=_ctx, timeout=180) as r:
        txt = r.read().decode("utf-8")
    return [json.loads(l) for l in txt.splitlines() if l.strip()]

def srvdate(off=0): return q(f"SELECT toString(today() - {int(off)}) v")[0]["v"]
def vnum(n): return bool(re.match(r"^\d{3,5}$", str(n).strip()))
TIENDA = "arrayLast(x -> 1, splitByString('-', shipping_polygon_name))"
FILTROS = "AND order_commerce_id NOT LIKE 'PM-%' AND order_commerce_id NOT LIKE '%RMA%' AND shipping_polygon_name != ''"
TARGETS = {"fill": 95, "otp": 98, "otd": 98, "falt_max": 5}

# ── Fechas (semana lunes→ayer) ──
AYER = date.fromisoformat(srvdate(1))
lunes = AYER - timedelta(days=AYER.weekday())
SEM_I, SEM_F = str(lunes), str(AYER + timedelta(days=1))
SEMA_I, SEMA_F = str(lunes - timedelta(days=7)), str(lunes)
HIST_I = str(AYER - timedelta(days=28))
SEM_LABEL = f"{lunes.strftime('%d/%m')} al {AYER.strftime('%d/%m/%Y')}"

def main():
    if not USER or not PASS: print("ERROR: faltan CH_USER/CH_PASS"); sys.exit(1)
    print(f"Snapshot semana {SEM_LABEL} (hasta {AYER}) · light={LIGHT}")

    # Q1 — KPIs por tienda (semana)
    q1 = q(f"""SELECT {TIENDA} AS t, countDistinct(order_id) ped, round(sum(total_amount),0) venta,
        sum(items_count) uni, countIf(shipping_type='delivery') hd, countIf(shipping_type='store_pickup') rt,
        countIf(shipping_type='drive_through') dt, sum(rescheduled_count) reprog,
        countIf(status_code='delivered') entreg, countIf(delivered_on_time=true AND status_code='delivered') otd
        FROM {DB}.orders WHERE shipping_dispatch_date >= '{SEM_I}' AND shipping_dispatch_date < '{SEM_F}' {FILTROS}
        GROUP BY t""")
    Q1 = {str(r["t"]).strip(): r for r in q1 if vnum(r["t"])}

    # Q2 — OT Preparación / Q3 — Fillrate (joins pesados; en light se preservan)
    Q2, Q3 = {}, {}
    if not LIGHT:
        q2 = q(f"""SELECT {TIENDA.replace('shipping_polygon_name','o.shipping_polygon_name')} AS t,
            countIf(s.step_name='picking' AND s.step_status='finished' AND o.delivery_sla_start IS NOT NULL AND s.step_date_end <= o.delivery_sla_start) prep_on,
            countIf(s.step_name='picking' AND s.step_status='finished' AND o.delivery_sla_start IS NOT NULL) prep_tot
            FROM {DB}.orders o JOIN {DB}.order_steps s ON o.order_id=s.order_id
            WHERE o.shipping_dispatch_date >= '{SEM_I}' AND o.shipping_dispatch_date < '{SEM_F}'
            AND o.order_commerce_id NOT LIKE 'PM-%' AND o.order_commerce_id NOT LIKE '%RMA%' AND o.shipping_polygon_name != ''
            GROUP BY t""")
        Q2 = {str(r["t"]).strip(): r for r in q2 if vnum(r["t"])}
        q3 = q(f"""SELECT {TIENDA.replace('shipping_polygon_name','o.shipping_polygon_name')} AS t,
            sum(oi.purchased_quantity) ip, sumIf(oi.purchased_quantity, oi.is_picked=true) io, sumIf(oi.purchased_quantity, oi.is_picked=false) ifn
            FROM (SELECT order_id, shipping_polygon_name FROM {DB}.orders
                  WHERE shipping_dispatch_date >= '{SEM_I}' AND shipping_dispatch_date < '{SEM_F}' {FILTROS}) o
            JOIN {DB}.order_items oi ON o.order_id=oi.order_id GROUP BY t""")
        Q3 = {str(r["t"]).strip(): r for r in q3 if vnum(r["t"])}

    # Q4 — VS semana anterior
    q4 = q(f"""SELECT
        countDistinctIf(order_id, shipping_dispatch_date>='{SEM_I}' AND shipping_dispatch_date<'{SEM_F}') ped,
        round(sumIf(total_amount, shipping_dispatch_date>='{SEM_I}' AND shipping_dispatch_date<'{SEM_F}'),0) ven,
        countDistinctIf(order_id, shipping_dispatch_date>='{SEMA_I}' AND shipping_dispatch_date<'{SEMA_F}') ped_a,
        round(sumIf(total_amount, shipping_dispatch_date>='{SEMA_I}' AND shipping_dispatch_date<'{SEMA_F}'),0) ven_a
        FROM {DB}.orders WHERE shipping_dispatch_date >= '{SEMA_I}' AND shipping_dispatch_date < '{SEM_F}' {FILTROS}""")
    r4 = q4[0] if q4 else {}

    # Q5 — Diario canal / Q6 — Diario por tienda (commerce_date_created)
    # En light: ventana corta (3 días) y se omite Q6 (se preserva el ds previo) -> mucha menos lectura.
    hist_i = str(AYER - timedelta(days=3 if LIGHT else 28))
    q5 = q(f"""SELECT toString(toDate(commerce_date_created)) f, countDistinct(order_id) p, round(sum(total_amount),0) v,
        sum(items_count) u, countIf(shipping_type='delivery') hd, countIf(shipping_type='store_pickup') rt, countIf(shipping_type='drive_through') dt
        FROM {DB}.orders WHERE commerce_date_created >= '{hist_i}' AND commerce_date_created < '{SEM_F}' {FILTROS}
        GROUP BY f ORDER BY f""")
    q6 = []
    if not LIGHT:
        q6 = q(f"""SELECT toString(toDate(commerce_date_created)) f, {TIENDA} AS t, countDistinct(order_id) p, round(sum(total_amount),0) v,
            sum(items_count) u, countIf(shipping_type='delivery') hd, countIf(shipping_type='store_pickup') rt, countIf(shipping_type='drive_through') dt
            FROM {DB}.orders WHERE commerce_date_created >= '{hist_i}' AND commerce_date_created < '{SEM_F}' {FILTROS}
            GROUP BY f, t""")

    # ── prev snapshot (para preservar OT/Fillrate/histórico en light) ──
    prev, prev_snap = {}, {}
    if LIGHT and OUT.exists():
        try:
            prev_snap = json.loads(OUT.read_text(encoding="utf-8"))
            prev = {s["num"]: s for s in prev_snap.get("stores", [])}
        except: pass

    n = lambda v, d=0: (float(v) if v not in (None, "", "nan") else d)
    stores = []
    for num, r in Q1.items():
        m = MASTER.get(num, {})
        ot2 = Q2.get(num); fl3 = Q3.get(num); pv = prev.get(num, {})
        po = n(ot2["prep_on"]) if ot2 else pv.get("_po", 0)
        pt = n(ot2["prep_tot"]) if ot2 else pv.get("_pt", 0)
        ip = n(fl3["ip"]) if fl3 else pv.get("_ip", 0)
        io = n(fl3["io"]) if fl3 else pv.get("_io", 0)
        fn = int(n(fl3["ifn"])) if fl3 else int(pv.get("_fn", 0))
        ped = int(n(r["ped"])); entreg = int(n(r["entreg"])); otd = int(n(r["otd"]))
        stores.append({
            "num": num, "nombre": m.get("nombre", num), "coord": m.get("coord", "Sin coord"),
            "formato": m.get("formato", "—"), "regional": m.get("regional", ""),
            "ventas_M": round(n(r["venta"]) / 1e6, 2), "pedidos": ped, "unidades": int(n(r["uni"])),
            "ticket_prom": int(n(r["venta"]) / ped) if ped else 0,
            "hd_p": int(n(r["hd"])), "rt_p": int(n(r["rt"])), "dt_p": int(n(r["dt"])),
            "ot_prep": round(po / pt * 100, 1) if pt else 0,
            "ot_del": round(otd / entreg * 100, 1) if entreg else 0,
            "fillrate": round(io / ip * 100, 1) if ip else 0,
            "falt_pct": round(fn / ip * 100, 2) if ip else 0, "falt_n": fn,
            "reprog_n": int(n(r["reprog"])), "reprog_pct": round(100 * n(r["reprog"]) / ped, 2) if ped else 0,
            "_po": po, "_pt": pt, "_ip": ip, "_io": io, "_fn": fn,  # crudos para light/agregar
        })

    # ── Totales (sa) ──
    tv = sum(s["ventas_M"] for s in stores); tp = sum(s["pedidos"] for s in stores)
    thd = sum(s["hd_p"] for s in stores); trt = sum(s["rt_p"] for s in stores); tdt = sum(s["dt_p"] for s in stores)
    ip_g = sum(s["_ip"] for s in stores); io_g = sum(s["_io"] for s in stores); fn_g = sum(s["_fn"] for s in stores)
    po_g = sum(s["_po"] for s in stores); pt_g = sum(s["_pt"] for s in stores)
    otd_g = sum(round(s["ot_del"] / 100 * s["pedidos"]) for s in stores)  # aprox
    pa = int(n(r4.get("ped_a"))); va = n(r4.get("ven_a")); pact = int(n(r4.get("ped"))); vact = n(r4.get("ven"))
    sa = {
        "semana": SEM_LABEL, "ventas_M": round(tv, 1), "pedidos": tp,
        "ticket_prom": round(tv * 1e6 / tp) if tp else 0, "unidades": sum(s["unidades"] for s in stores),
        "pct_hd": round(thd / tp * 100, 1) if tp else 0, "pct_rt": round(trt / tp * 100, 1) if tp else 0,
        "pct_dt": round(tdt / tp * 100, 1) if tp else 0,
        "fillrate": round(io_g / ip_g * 100, 1) if ip_g else 0,
        "falt_pct": round(fn_g / ip_g * 100, 2) if ip_g else 0,
        "ot_prep": round(po_g / pt_g * 100, 1) if pt_g else 0,
        "var_ped_lw": round((pact - pa) / pa * 100, 1) if pa else 0,
        "var_ven_lw": round((vact - va) / va * 100, 1) if va else 0,
        "ped_ant": pa, "ven_ant_M": round(va / 1e6, 1),
    }

    # ── Por coordinador ──
    coords = {}
    for c in ["Pedro", "Nicolás", "Germán"]:
        cs = [s for s in stores if s["coord"] == c]
        act = [s for s in cs if s["ventas_M"] > 0]
        vt = sum(s["ventas_M"] for s in cs)
        ipc = sum(s["_ip"] for s in cs); ioc = sum(s["_io"] for s in cs); fnc = sum(s["_fn"] for s in cs)
        poc = sum(s["_po"] for s in cs); ptc = sum(s["_pt"] for s in cs)
        coords[c] = {
            "tiendas": len(cs), "activas": len(act), "ventas_M": round(vt, 1),
            "pedidos": sum(s["pedidos"] for s in cs), "unidades": sum(s["unidades"] for s in cs),
            "share_pct": round(vt / tv * 100, 1) if tv else 0,
            "ot_prep": round(poc / ptc * 100, 1) if ptc else 0,
            "fillrate": round(ioc / ipc * 100, 1) if ipc else 0,
            "falt_pct": round(fnc / ipc * 100, 2) if ipc else 0,
            "f1": len([s for s in cs if s["formato"] == "Full 1"]),
            "f2": len([s for s in cs if s["formato"] == "Full 2"]),
            "gm": len([s for s in cs if s["formato"] == "GM"]),
        }

    # ── Daily ──
    daily = [{"f": r["f"], "p": int(n(r["p"])), "v": round(n(r["v"]) / 1e6, 2), "u": int(n(r["u"])),
              "hd": int(n(r["hd"])), "rt": int(n(r["rt"])), "dt": int(n(r["dt"]))}
             for r in q5 if int(n(r["p"])) >= 30]
    if LIGHT and prev_snap.get("daily"):  # mantener histórico previo, refrescar los días nuevos
        freshf = {d["f"] for d in daily}
        daily = sorted([d for d in prev_snap["daily"] if d["f"] not in freshf] + daily, key=lambda x: x["f"])
    if LIGHT:
        ds = prev_snap.get("ds", {})  # Q6 omitido en light -> se preserva
    else:
        ds = {}
        for r in q6:
            if not vnum(r["t"]): continue
            ds.setdefault(r["f"], {})[str(r["t"]).strip()] = {"p": int(n(r["p"])), "v": round(n(r["v"]) / 1e6, 3), "u": int(n(r["u"])),
                "hd": int(n(r["hd"])), "rt": int(n(r["rt"])), "dt": int(n(r["dt"]))}

    # limpiar crudos
    for s in stores:
        for k in ("_po", "_pt", "_ip", "_io", "_fn"): s.pop(k, None)
    stores.sort(key=lambda s: -s["ventas_M"])

    snap = {"meta": {"upd": datetime.now(timezone.utc).isoformat(), "semana": SEM_LABEL, "targets": TARGETS, "light": LIGHT},
            "sa": sa, "coords": coords, "stores": stores, "daily": daily, "ds": ds}
    if not stores:
        print("⚠️  Sin datos (cuota?). No se sobrescribe."); sys.exit(0)
    OUT.write_text(json.dumps(snap, ensure_ascii=False), encoding="utf-8")
    print(f"OK -> snapshot.json · {len(stores)} tiendas · venta ${sa['ventas_M']}M · {sa['pedidos']} ped · OTprep {sa['ot_prep']}% · fill {sa['fillrate']}%")

if __name__ == "__main__":
    main()

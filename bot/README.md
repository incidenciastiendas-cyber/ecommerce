# 🤖 Bot ETL (Python)

Arma el JSON de indicadores de **un día** (por tienda) leyendo ClickHouse.
Sin dependencias externas (solo stdlib). Lee **poco** (un solo día) para respetar
la cuota de ~5 GB/día del data lake.

## Pipeline
- **Cierre** (1 vez/día, tras medianoche): día cerrado = **ayer** → `public/data/dias/<fecha>.json` (definitivo, se commitea).
- **Intradía** (cada 30 min): día en curso = **hoy** → se regenera y se pisa (no se commitea hasta el cierre del día siguiente).

## Uso local
```bash
CH_USER=usuario CH_PASS=password python bot/build_day.py cierre      # ayer
CH_USER=usuario CH_PASS=password python bot/build_day.py intradia    # hoy
CH_USER=usuario CH_PASS=password python bot/build_day.py 2026-06-09  # fecha puntual
```

## Salida
- `public/data/dias/<fecha>.json` — datos del día por tienda (ventas + gestión).
- `public/data/index.json` — lista de días disponibles (para el selector del dashboard).

## Variables de entorno
`CH_USER`, `CH_PASS` (obligatorias) · `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_SCHEMA` (opcionales, con default).

Automatizado por GitHub Actions: `.github/workflows/cierre-diario.yml` e `intradia.yml`.

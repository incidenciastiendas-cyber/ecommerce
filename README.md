# 📊 JANIS Dashboards · Masonline

Dashboards de **solo lectura** sobre el data lake de JANIS (logística / e-commerce de Masonline).
Conexión vía **API/ClickHouse** a través de un proxy seguro en Firebase Cloud Functions.
Sin base de datos propia, sin input de usuario — solo visualización.

## 🏗️ Arquitectura (ETL → snapshot, NO consulta en vivo)

> ⚠️ El data lake tiene **cuota de lectura ~5 GB/día**. Por eso el dashboard **no consulta
> ClickHouse en vivo**: un ETL programado captura los agregados cada 30 min y el frontend
> lee ese snapshot ya calculado (instantáneo y barato).

```
GitHub Actions (cron */30)  ──>  etl/build-snapshot.js  ──>  consulta ClickHouse (liviano)
        │                                                     (quantics.data-lake.janis.in:8443)
        ▼
  public/data/snapshot.json  ──>  Firebase Hosting  ──>  Dashboard (lee el snapshot)
                                        + Firebase Auth (login @gdnargentina.com)
```

- El frontend **nunca** toca ClickHouse ni ve credenciales: solo lee el snapshot.
- El ETL corre **server-side** (GitHub Actions) con las credenciales en GitHub Secrets.
- **Modo DEMO:** si `public/firebase-config.js` no tiene `apiKey` real, el front saltea el login
  y muestra el snapshot → permite previsualizar sin deployar.
- Cloud Functions (`functions/`) quedan como **opción** para consultas en vivo puntuales
  (ej. "productos no encontrados" detallado). Requieren plan Blaze; el resto es plan gratuito.

### 🔑 Secrets de GitHub Actions (repo → Settings → Secrets → Actions)
| Secret | Valor |
|---|---|
| `CLICKHOUSE_USER` | usuario del data lake |
| `CLICKHOUSE_PASSWORD` | password del data lake |
| `FIREBASE_SERVICE_ACCOUNT` | contenido del JSON del service account (masonline-f2736) |

### ▶️ Correr el ETL local
```bash
CH_USER=.. CH_PASS=.. node etl/build-snapshot.js   # genera public/data/snapshot.json
```

Ver [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) y el mapeo de campos en [docs/DICCIONARIO_DATOS.md](docs/DICCIONARIO_DATOS.md).

## 🔐 Seguridad — LEER

- **NUNCA** commitear credenciales ni el `*firebase-adminsdk*.json`. Ya están en `.gitignore`.
- Las credenciales se manejan con **secrets de Firebase** y archivos `.env` (gitignoreados).
- Si alguna credencial se compartió en texto plano, **rotarla**.

## 🚀 Puesta en marcha

### 1. Requisitos
```bash
npm install -g firebase-tools
firebase login
```

### 2. Instalar dependencias de las functions
```bash
cd functions && npm install && cd ..
```

### 3. Configurar credenciales (NO van a git)

**Local** (emulador): copiar y completar
```bash
cp functions/.env.example functions/.env   # completar CLICKHOUSE_USER, etc.
```

**Producción**: el password como secret
```bash
firebase functions:secrets:set CLICKHOUSE_PASSWORD
# y el resto de config no-secreta en functions/.env (se sube en el deploy)
```

### 4. Config pública del frontend
Completar `public/firebase-config.js` con el `apiKey` y `appId` del Web App
(consola Firebase → Configuración del proyecto → Tus apps → Web).

### 5. Auth
En consola Firebase → Authentication → Sign-in method → habilitar **Google**.
(Opcional, recomendado) restringir el dominio también a nivel organización.

### 6. Deploy
```bash
firebase deploy            # hosting + functions
# o por partes:
firebase deploy --only functions
firebase deploy --only hosting
```

### 7. Desarrollo local
```bash
firebase emulators:start
```

## ➕ Agregar un dashboard nuevo

1. Definir la query en [`functions/queries.js`](functions/queries.js) (id + params + SQL parametrizado).
2. Listo: el frontend la lista sola vía `listAvailableQueries`.

Reporte incluido: **`productos_no_encontrados`** — productos no encontrados / reemplazados
en el picking (tienda, SKU, horario, estado), parámetro `dias`.

## 📁 Estructura
```
.
├── public/              # Frontend (Hosting) — dashboards
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── firebase-config.js   # config PÚBLICA (completar apiKey/appId)
├── functions/           # Cloud Functions (proxy ClickHouse + auth)
│   ├── index.js
│   ├── clickhouse.js
│   └── queries.js
├── docs/                # Diccionario de datos + arquitectura
├── firebase.json
└── .firebaserc          # proyecto: masonline-f2736
```

## ⚠️ Nota sobre el esquema
El front del data lake usaba el prefijo `datalake.<tabla>`. La base por defecto de la
conexión directa es `janis_datawarehouse_masonline`. Si las tablas no resuelven con
`datalake.`, ajustar `CLICKHOUSE_SCHEMA` en el `.env`.

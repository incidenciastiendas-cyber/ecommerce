# 🏗️ Arquitectura propuesta — App JANIS

## ❓ "Si es una conexión vía API, ¿no necesito base de datos?"

**Sí y no.** Tenés razón a medias:

- ✅ **No necesitás una DB para *replicar* los datos de JANIS.** La API (o el data lake) ya es tu fuente de verdad. No hay que copiar pedidos/picking/rutas a una base propia.
- ⚠️ **Pero casi seguro vas a querer Firestore igual**, por estas razones:

| Necesidad | ¿Va en DB propia? |
|---|---|
| Datos de JANIS (pedidos, picking, rutas) | ❌ No — vienen de la API |
| Login / usuarios / roles | ✅ Firebase **Auth** |
| Búsquedas guardadas, favoritos, notas sobre productos | ✅ Firestore |
| Flags propios (ej. "este faltante ya lo gestioné") | ✅ Firestore |
| Caché de consultas lentas (el lake tarda 8–18s) | ✅ Firestore / Functions |
| Auditoría: quién buscó qué y cuándo | ✅ Firestore |

> **Conclusión:** podés arrancar **sin DB** (solo API), pero dejá Firestore listo desde el inicio porque lo vas a necesitar para la capa "app".

## 🚨 Lo más importante: NO llames la API directo desde el navegador

Si la app (frontend) llama la API de JANIS directamente, **exponés las credenciales/API keys** a cualquiera que abra DevTools. Eso es un agujero de seguridad. Además vas a chocar con **CORS**.

**Solución:** una capa intermedia (backend) que guarde la key del lado servidor y haga de proxy.

## 📐 Arquitectura recomendada (toda en Firebase)

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  Frontend        │     │  Firebase Cloud       │     │  API JANIS       │
│  (React/Next)    │────▶│  Functions (proxy)    │────▶│  (o ClickHouse)  │
│  Firebase Hosting│◀────│  - guarda la API key  │◀────│                  │
└─────────────────┘     │  - cachea respuestas  │     └─────────────────┘
        │                └──────────┬───────────┘
        │                           │
        ▼                           ▼
┌─────────────────┐     ┌──────────────────────┐
│  Firebase Auth   │     │  Firestore            │
│  (login Google)  │     │  (datos de la app)    │
└─────────────────┘     └──────────────────────┘
```

**Piezas de Firebase:**
1. **Hosting** → sirve el frontend (estático / Next.js).
2. **Cloud Functions** → backend que (a) guarda la API key, (b) llama a JANIS, (c) cachea resultados pesados.
3. **Auth** → login (ya usás Google login en JANIS, encaja perfecto).
4. **Firestore** → datos propios de la app (búsquedas, flags, notas, caché).

## 🧩 Decisión pendiente: ¿qué "API" tenés exactamente?

Esto cambia el mapeo de campos:

- **Opción A — API REST operativa de JANIS:** los campos vienen **anidados / camelCase** (ej. `order.shipping.deliveryWindow.start`). El [DICCIONARIO_DATOS.md](DICCIONARIO_DATOS.md) sirve como mapa semántico, pero hay que cruzarlo con la doc de la API.
- **Opción B — API tipo "query al data lake"** (como el `/api/clickhouse/query` que usamos): los campos son **exactamente** los del diccionario (snake_case).

👉 **Necesito que me pases la doc / un ejemplo de respuesta de tu API** para alinear el mapeo fino.

## ✅ Próximos pasos sugeridos

1. Vos: crear repo en GitHub + proyecto en Firebase (Hosting + Functions + Firestore + Auth).
2. Vos: pasarme la doc o un response de ejemplo de la API.
3. Yo: armo el mapeo API↔diccionario y propongo los endpoints/funciones del proxy.
4. Definir las primeras pantallas (ej. "Productos no encontrados por tienda" — ya tenemos el SQL/lógica).

// ─────────────────────────────────────────────────────────────
//  Config pública del Web App de Firebase (NO es secreta — puede ir a git).
//  Sacala de: consola Firebase → ⚙ Configuración del proyecto →
//  "Tus apps" → Web app → SDK setup → Config.
//
//  ⚠️ COMPLETAR apiKey y appId (los demás ya están con el proyecto masonline-f2736).
// ─────────────────────────────────────────────────────────────
export const firebaseConfig = {
  apiKey: "TODO_PEGAR_API_KEY",
  authDomain: "masonline-f2736.firebaseapp.com",
  projectId: "masonline-f2736",
  storageBucket: "masonline-f2736.appspot.com",
  messagingSenderId: "TODO_PEGAR_SENDER_ID",
  appId: "TODO_PEGAR_APP_ID",
};

// Región de las Cloud Functions (debe coincidir con functions/index.js)
export const FUNCTIONS_REGION = "southamerica-east1";

// Dominio permitido para login
export const ALLOWED_DOMAIN = "gdnargentina.com";

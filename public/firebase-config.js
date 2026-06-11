// ─────────────────────────────────────────────────────────────
//  Config pública del Web App de Firebase (NO es secreta — puede ir a git).
//  Sacala de: consola Firebase → ⚙ Configuración del proyecto →
//  "Tus apps" → Web app → SDK setup → Config.
//
//  ⚠️ COMPLETAR apiKey y appId (los demás ya están con el proyecto masonline-f2736).
// ─────────────────────────────────────────────────────────────
export const firebaseConfig = {
  apiKey: "AIzaSyA1FfrzynF8vHhMn1bZvreOjBdl6qMednA",
  authDomain: "masonline-f2736.firebaseapp.com",
  projectId: "masonline-f2736",
  storageBucket: "masonline-f2736.firebasestorage.app",
  messagingSenderId: "495889936833",
  appId: "1:495889936833:web:d6e5205a7194d293fabf40",
  measurementId: "G-B2FP0EFVCK",
};

// Región de las Cloud Functions (debe coincidir con functions/index.js)
export const FUNCTIONS_REGION = "southamerica-east1";

// Dominio permitido para login
export const ALLOWED_DOMAIN = "gdnargentina.com";

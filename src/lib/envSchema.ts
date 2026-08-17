import { z } from "zod";

// Esquema de las variables de entorno que la app necesita para conectarse a Firebase.
// Sin efectos secundarios (no parsea nada acá): lo consumen tanto env.ts (navegador,
// lee import.meta.env) como scripts/seed.ts (Node, lee process.env), cada uno con
// su propia fuente de datos, para no duplicar la lista de variables dos veces.
export const envSchema = z.object({
  VITE_FIREBASE_API_KEY: z.string().min(1, "Falta VITE_FIREBASE_API_KEY en .env"),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().min(1, "Falta VITE_FIREBASE_AUTH_DOMAIN en .env"),
  VITE_FIREBASE_PROJECT_ID: z.string().min(1, "Falta VITE_FIREBASE_PROJECT_ID en .env"),
  VITE_FIREBASE_STORAGE_BUCKET: z.string().min(1, "Falta VITE_FIREBASE_STORAGE_BUCKET en .env"),
  VITE_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1, "Falta VITE_FIREBASE_MESSAGING_SENDER_ID en .env"),
  VITE_FIREBASE_APP_ID: z.string().min(1, "Falta VITE_FIREBASE_APP_ID en .env"),
});

import { envSchema } from "./envSchema";

// `parse` tira una excepción si algo no cumple el schema, cortando el arranque de la app.
// import.meta.env es el objeto que Vite arma en tiempo de build/dev a partir de .env;
// solo existe en el contexto del navegador/bundle, nunca en un script de Node plano.
export const env = envSchema.parse(import.meta.env);

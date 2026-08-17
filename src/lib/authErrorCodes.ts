// Códigos propios de la app para errores de autenticación, en un solo lugar
// (SCREAMING_SNAKE_CASE, "as const"), como pide la sección de manejo de
// errores del proyecto: el "code" es el contrato estable que puede usar el
// resto de la app para tomar decisiones programáticas (ej. mostrar una
// acción distinta según el error), sin depender del texto del mensaje (que
// está en español y pensado para mostrarse, no para comparar en código).
//
// Varios códigos de Firebase colapsan al mismo código propio a propósito:
// auth/user-not-found, auth/wrong-password y auth/invalid-credential
// comparten INVALID_CREDENTIALS porque, por seguridad, nunca se distingue
// "el usuario no existe" de "la contraseña está mal" (evita que alguien
// pueda enumerar qué emails están registrados).
export const AUTH_ERROR_CODES = {
  EMAIL_ALREADY_IN_USE: "EMAIL_ALREADY_IN_USE",
  WEAK_PASSWORD: "WEAK_PASSWORD",
  OPERATION_NOT_ALLOWED: "OPERATION_NOT_ALLOWED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  USER_DISABLED: "USER_DISABLED",
  INVALID_EMAIL: "INVALID_EMAIL",
  TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS",
  NETWORK_ERROR: "NETWORK_ERROR",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

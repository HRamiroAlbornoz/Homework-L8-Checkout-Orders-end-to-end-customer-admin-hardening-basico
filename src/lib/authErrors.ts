import { FirebaseError } from "firebase/app";
import { AUTH_ERROR_CODES, type AuthErrorCode } from "./authErrorCodes";

// Error estructurado { code, message } para toda la capa de autenticación,
// en vez de un Error plano con solo un mensaje. "code" es el contrato
// estable (SCREAMING_SNAKE_CASE, definido en authErrorCodes.ts) que el resto
// de la app puede usar para tomar decisiones programáticas sin parsear el
// texto en español de "message" (que es humano y puede cambiar de redacción
// sin romper nada). "cause" preserva el error original de Firebase para
// debug interno; nunca se serializa al cliente.
export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthError";
    this.code = code;
  }
}

// Mapeo de códigos de error de Firebase Auth (SDK modular v9+) a { code,
// message } propios. Nunca se expone error.code de Firebase (el técnico) ni
// error.message crudo en la UI. La tabla completa (qué códigos se
// incluyeron, cuáles se descartaron y por qué) está documentada en
// docs/auth-notes.md, sección 1.
const AUTH_ERROR_MAP: Record<string, { code: AuthErrorCode; message: string }> = {
  // Signup (createUserWithEmailAndPassword)
  "auth/email-already-in-use": {
    code: AUTH_ERROR_CODES.EMAIL_ALREADY_IN_USE,
    message: "Ya existe una cuenta registrada con ese email.",
  },
  "auth/weak-password": {
    code: AUTH_ERROR_CODES.WEAK_PASSWORD,
    message: "La contraseña debe tener al menos 8 caracteres, combinando letras y números.",
  },
  "auth/operation-not-allowed": {
    code: AUTH_ERROR_CODES.OPERATION_NOT_ALLOWED,
    message: "El registro con email y contraseña no está habilitado en este momento.",
  },

  // Login (signInWithEmailAndPassword)
  "auth/invalid-credential": {
    code: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
    message: "Email o contraseña incorrectos.",
  },
  "auth/user-not-found": {
    code: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
    message: "Email o contraseña incorrectos.",
  },
  "auth/wrong-password": {
    code: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
    message: "Email o contraseña incorrectos.",
  },
  "auth/user-disabled": {
    code: AUTH_ERROR_CODES.USER_DISABLED,
    message: "Esta cuenta fue deshabilitada. Contactá al administrador.",
  },

  // Compartidos entre signup y login
  "auth/invalid-email": {
    code: AUTH_ERROR_CODES.INVALID_EMAIL,
    message: "El email ingresado no es válido.",
  },
  "auth/too-many-requests": {
    code: AUTH_ERROR_CODES.TOO_MANY_REQUESTS,
    message: "Demasiados intentos fallidos. Probá de nuevo en unos minutos.",
  },
  "auth/network-request-failed": {
    code: AUTH_ERROR_CODES.NETWORK_ERROR,
    message: "Hubo un problema de conexión. Revisá tu internet e intentá de nuevo.",
  },
};

const FALLBACK_MESSAGE = "Ocurrió un error inesperado. Intentá de nuevo.";

// Traduce cualquier error que lance el SDK de Firebase Auth (o cualquier otro
// paso del flujo de auth, ej. Firestore) a un AuthError con mensaje amigable
// en español. Si el error no es un FirebaseError reconocido, o su código no
// está en la tabla, devuelve AUTH_ERROR_CODES.UNKNOWN_ERROR con el mensaje
// genérico, en vez de romper la UI o filtrar detalles técnicos.
export function mapAuthError(error: unknown): AuthError {
  if (error instanceof FirebaseError) {
    const mapped = AUTH_ERROR_MAP[error.code];
    if (mapped) {
      return new AuthError(mapped.code, mapped.message, { cause: error });
    }
  }
  return new AuthError(AUTH_ERROR_CODES.UNKNOWN_ERROR, FALLBACK_MESSAGE, { cause: error });
}

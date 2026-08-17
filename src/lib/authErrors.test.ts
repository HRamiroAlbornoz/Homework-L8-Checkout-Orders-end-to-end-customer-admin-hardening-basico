import { describe, it, expect } from "vitest";
import { FirebaseError } from "firebase/app";
import { mapAuthError, AuthError } from "./authErrors";
import { AUTH_ERROR_CODES } from "./authErrorCodes";

const FALLBACK_MESSAGE = "Ocurrió un error inesperado. Intentá de nuevo.";

// Arma un FirebaseError real (no un mock) para cada test: mapAuthError es una
// función pura que no toca red ni Firestore, así que no hace falta mockear nada.
function firebaseError(code: string, message = `Firebase: Error (${code}).`): FirebaseError {
  return new FirebaseError(code, message);
}

describe("mapAuthError", () => {
  describe("códigos de signup", () => {
    it.each([
      ["auth/email-already-in-use", AUTH_ERROR_CODES.EMAIL_ALREADY_IN_USE, "Ya existe una cuenta registrada con ese email."],
      [
        "auth/weak-password",
        AUTH_ERROR_CODES.WEAK_PASSWORD,
        "La contraseña debe tener al menos 8 caracteres, combinando letras y números.",
      ],
      [
        "auth/operation-not-allowed",
        AUTH_ERROR_CODES.OPERATION_NOT_ALLOWED,
        "El registro con email y contraseña no está habilitado en este momento.",
      ],
    ])("traduce %s", (firebaseCode, expectedCode, expectedMessage) => {
      const result = mapAuthError(firebaseError(firebaseCode));
      expect(result.message).toBe(expectedMessage);
      expect(result.code).toBe(expectedCode);
    });
  });

  describe("códigos de login", () => {
    it.each([
      ["auth/invalid-credential", AUTH_ERROR_CODES.INVALID_CREDENTIALS, "Email o contraseña incorrectos."],
      ["auth/user-not-found", AUTH_ERROR_CODES.INVALID_CREDENTIALS, "Email o contraseña incorrectos."],
      ["auth/wrong-password", AUTH_ERROR_CODES.INVALID_CREDENTIALS, "Email o contraseña incorrectos."],
      [
        "auth/user-disabled",
        AUTH_ERROR_CODES.USER_DISABLED,
        "Esta cuenta fue deshabilitada. Contactá al administrador.",
      ],
    ])("traduce %s", (firebaseCode, expectedCode, expectedMessage) => {
      const result = mapAuthError(firebaseError(firebaseCode));
      expect(result.message).toBe(expectedMessage);
      expect(result.code).toBe(expectedCode);
    });
  });

  describe("códigos compartidos entre signup y login", () => {
    it.each([
      ["auth/invalid-email", AUTH_ERROR_CODES.INVALID_EMAIL, "El email ingresado no es válido."],
      [
        "auth/too-many-requests",
        AUTH_ERROR_CODES.TOO_MANY_REQUESTS,
        "Demasiados intentos fallidos. Probá de nuevo en unos minutos.",
      ],
      [
        "auth/network-request-failed",
        AUTH_ERROR_CODES.NETWORK_ERROR,
        "Hubo un problema de conexión. Revisá tu internet e intentá de nuevo.",
      ],
    ])("traduce %s", (firebaseCode, expectedCode, expectedMessage) => {
      const result = mapAuthError(firebaseError(firebaseCode));
      expect(result.message).toBe(expectedMessage);
      expect(result.code).toBe(expectedCode);
    });
  });

  it("el resultado es una instancia de AuthError, y también de Error (compatible con .rejects.toThrow)", () => {
    const result = mapAuthError(firebaseError("auth/invalid-credential"));

    expect(result).toBeInstanceOf(AuthError);
    expect(result).toBeInstanceOf(Error);
    expect(result.name).toBe("AuthError");
  });

  it("preserva el error original de Firebase en 'cause', para debug interno", () => {
    const original = firebaseError("auth/invalid-credential");

    const result = mapAuthError(original);

    expect(result.cause).toBe(original);
  });

  it("user-not-found y wrong-password devuelven el mismo mensaje Y el mismo code que invalid-credential (no revelan si el usuario existe)", () => {
    const results = [
      mapAuthError(firebaseError("auth/invalid-credential")),
      mapAuthError(firebaseError("auth/user-not-found")),
      mapAuthError(firebaseError("auth/wrong-password")),
    ];

    expect(new Set(results.map((r) => r.message)).size).toBe(1);
    expect(new Set(results.map((r) => r.code)).size).toBe(1);
    expect(results[0]?.code).toBe(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
  });

  it("nunca expone error.code de Firebase ni error.message crudo en el mensaje devuelto", () => {
    const error = firebaseError("auth/weak-password", "Firebase: Password should be at least 6 characters.");

    const result = mapAuthError(error);

    expect(result.message).not.toContain("auth/weak-password");
    expect(result.message).not.toContain("Firebase:");
    expect(result.message).not.toContain("Password should be at least");
  });

  it("nunca expone datos de customData (ej. el email intentado) en el mensaje devuelto", () => {
    const error = new FirebaseError("auth/user-not-found", "Firebase: Error (auth/user-not-found).", {
      email: "hernan@example.com",
    });

    expect(mapAuthError(error).message).not.toContain("hernan@example.com");
  });

  it("devuelve UNKNOWN_ERROR con el mensaje genérico si el código no está en la tabla de mapeo", () => {
    const result = mapAuthError(firebaseError("auth/codigo-no-mapeado"));

    expect(result.message).toBe(FALLBACK_MESSAGE);
    expect(result.code).toBe(AUTH_ERROR_CODES.UNKNOWN_ERROR);
  });

  it("devuelve el mensaje genérico si el código no existe en absoluto en Firebase", () => {
    expect(mapAuthError(firebaseError("auth/este-codigo-no-existe-en-firebase")).message).toBe(FALLBACK_MESSAGE);
  });

  it("es sensible a mayúsculas/minúsculas: un código con otro casing no matchea (defensivo, Firebase siempre manda minúsculas)", () => {
    expect(mapAuthError(firebaseError("AUTH/EMAIL-ALREADY-IN-USE")).message).toBe(FALLBACK_MESSAGE);
  });

  it("devuelve el mensaje genérico si el code es un string vacío", () => {
    expect(mapAuthError(firebaseError("")).message).toBe(FALLBACK_MESSAGE);
  });

  it("devuelve el mensaje genérico si el error no es un FirebaseError, aunque tenga forma parecida (duck typing no cuenta)", () => {
    const fakeFirebaseError = { code: "auth/email-already-in-use", message: "parece un FirebaseError pero no lo es" };

    expect(mapAuthError(fakeFirebaseError).message).toBe(FALLBACK_MESSAGE);
  });

  it("devuelve el mensaje genérico si el error es un Error común (no de Firebase)", () => {
    expect(mapAuthError(new Error("fallo de red genérico")).message).toBe(FALLBACK_MESSAGE);
  });

  it("devuelve el mensaje genérico ante valores que ni siquiera son un Error", () => {
    expect(mapAuthError("fallo desconocido").message).toBe(FALLBACK_MESSAGE);
    expect(mapAuthError(undefined).message).toBe(FALLBACK_MESSAGE);
    expect(mapAuthError(null).message).toBe(FALLBACK_MESSAGE);
    expect(mapAuthError(42).message).toBe(FALLBACK_MESSAGE);
    expect(mapAuthError({}).message).toBe(FALLBACK_MESSAGE);
    expect(mapAuthError([]).message).toBe(FALLBACK_MESSAGE);
  });

  it("todos los mensajes de la tabla están en español, no vienen vacíos, y tienen un code distinto de UNKNOWN_ERROR", () => {
    const codes = [
      "auth/email-already-in-use",
      "auth/weak-password",
      "auth/operation-not-allowed",
      "auth/invalid-credential",
      "auth/user-not-found",
      "auth/wrong-password",
      "auth/user-disabled",
      "auth/invalid-email",
      "auth/too-many-requests",
      "auth/network-request-failed",
    ];

    for (const code of codes) {
      const result = mapAuthError(firebaseError(code));
      expect(result.message.length).toBeGreaterThan(0);
      expect(result.message).not.toBe(FALLBACK_MESSAGE);
      expect(result.code).not.toBe(AUTH_ERROR_CODES.UNKNOWN_ERROR);
    }
  });
});

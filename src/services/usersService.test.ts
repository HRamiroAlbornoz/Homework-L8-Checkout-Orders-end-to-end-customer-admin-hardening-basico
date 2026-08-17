import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// Nunca tocamos Firestore real. Mockeamos solo doc/getDoc/setDoc/serverTimestamp;
// el resto del módulo (incluida la clase Timestamp, que usa userDocSchema para
// validar "createdAt") queda real, para no tener que reimplementar su lógica interna.
vi.mock("../lib/firebase", () => ({ db: {} }));

vi.mock("firebase/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/firestore")>();
  return {
    ...actual,
    doc: vi.fn((_db: unknown, collection: string, id: string) => ({ __ref: true, collection, id })),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    serverTimestamp: vi.fn(() => ({ __type: "serverTimestamp" })),
  };
});

import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { getUserProfile, createUserProfile } from "./usersService";

function fakeSnapshot(exists: boolean, data?: Record<string, unknown>) {
  return {
    exists: () => exists,
    data: vi.fn(() => data),
  };
}

const validDocData = {
  email: "hernan@example.com",
  displayName: "Hernán",
  role: "customer" as const,
  createdAt: Timestamp.now(),
};

describe("usersService.getUserProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("consulta el documento users/{uid}", async () => {
    (getDoc as Mock).mockResolvedValueOnce(fakeSnapshot(true, validDocData));

    await getUserProfile("uid-1");

    expect(doc).toHaveBeenCalledWith(db, "users", "uid-1");
  });

  it("devuelve el perfil con el uid incorporado cuando el documento existe", async () => {
    (getDoc as Mock).mockResolvedValueOnce(fakeSnapshot(true, validDocData));

    const profile = await getUserProfile("uid-1");

    expect(profile).toEqual({ uid: "uid-1", ...validDocData });
  });

  it("pide el timestamp del servidor como 'estimate', no como valor ausente (evita leer createdAt sin resolver justo después de escribirlo)", async () => {
    const snapshot = fakeSnapshot(true, validDocData);
    (getDoc as Mock).mockResolvedValueOnce(snapshot);

    await getUserProfile("uid-1");

    expect(snapshot.data).toHaveBeenCalledWith({ serverTimestamps: "estimate" });
  });

  it("valida los datos crudos con Zod antes de confiar en ellos (rechaza un email con formato inválido)", async () => {
    (getDoc as Mock).mockResolvedValueOnce(
      fakeSnapshot(true, { ...validDocData, email: "esto-no-es-un-email" })
    );

    await expect(getUserProfile("uid-1")).rejects.toThrow();
  });

  it("valida los datos crudos con Zod antes de confiar en ellos (rechaza un role fuera del enum)", async () => {
    (getDoc as Mock).mockResolvedValueOnce(fakeSnapshot(true, { ...validDocData, role: "superadmin" }));

    await expect(getUserProfile("uid-1")).rejects.toThrow();
  });

  it("no reintenta cuando el documento ya existe en el primer intento", async () => {
    (getDoc as Mock).mockResolvedValueOnce(fakeSnapshot(true, validDocData));

    await getUserProfile("uid-1");

    expect(getDoc).toHaveBeenCalledTimes(1);
  });

  it("preserva displayName null al leer un perfil sin nombre para mostrar", async () => {
    (getDoc as Mock).mockResolvedValueOnce(fakeSnapshot(true, { ...validDocData, displayName: null }));

    const profile = await getUserProfile("uid-1");

    expect(profile?.displayName).toBeNull();
  });

  it("rechaza el documento si falta el campo email", async () => {
    const docSinEmail = {
      displayName: validDocData.displayName,
      role: validDocData.role,
      createdAt: validDocData.createdAt,
    };
    (getDoc as Mock).mockResolvedValueOnce(fakeSnapshot(true, docSinEmail));

    await expect(getUserProfile("uid-1")).rejects.toThrow();
  });

  it("rechaza createdAt si no es una instancia real de Timestamp (ej. un Date armado a mano)", async () => {
    (getDoc as Mock).mockResolvedValueOnce(fakeSnapshot(true, { ...validDocData, createdAt: new Date() }));

    await expect(getUserProfile("uid-1")).rejects.toThrow();
  });

  it("rechaza displayName vacío ('') porque el schema exige al menos 1 caracter", async () => {
    (getDoc as Mock).mockResolvedValueOnce(fakeSnapshot(true, { ...validDocData, displayName: "" }));

    await expect(getUserProfile("uid-1")).rejects.toThrow();
  });

  it("reintenta con backoff exponencial si el documento todavía no existe (carrera con createUserProfile justo tras un signup)", async () => {
    vi.useFakeTimers();
    (getDoc as Mock)
      .mockResolvedValueOnce(fakeSnapshot(false))
      .mockResolvedValueOnce(fakeSnapshot(true, validDocData));

    const pending = getUserProfile("uid-1");
    await vi.runAllTimersAsync();
    const profile = await pending;

    expect(getDoc).toHaveBeenCalledTimes(2);
    expect(profile).toEqual({ uid: "uid-1", ...validDocData });
    vi.useRealTimers();
  });

  it("devuelve null (nunca asume un rol por defecto) si el documento no aparece tras agotar los 3 intentos", async () => {
    vi.useFakeTimers();
    (getDoc as Mock).mockResolvedValue(fakeSnapshot(false));

    const pending = getUserProfile("uid-1");
    await vi.runAllTimersAsync();
    const profile = await pending;

    expect(profile).toBeNull();
    expect(getDoc).toHaveBeenCalledTimes(3); // intento inicial + 2 reintentos con backoff exponencial
    vi.useRealTimers();
  });

  it("propaga el último error si TODOS los intentos de getDoc fallan (se agota el backoff)", async () => {
    vi.useFakeTimers();
    (getDoc as Mock).mockRejectedValue(new Error("permission-denied"));

    const pending = getUserProfile("uid-1");
    pending.catch(() => {}); // evita el warning de "unhandled rejection" mientras avanzan los timers
    await vi.runAllTimersAsync();

    await expect(pending).rejects.toThrow("permission-denied");
    expect(getDoc).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("envuelve en un Error genérico si todos los intentos de getDoc fallan con algo que no es un Error", async () => {
    vi.useFakeTimers();
    (getDoc as Mock).mockRejectedValue("fallo desconocido");

    const pending = getUserProfile("uid-1");
    pending.catch(() => {}); // evita el warning de "unhandled rejection" mientras avanzan los timers
    await vi.runAllTimersAsync();

    await expect(pending).rejects.toThrow("Error desconocido al leer el perfil de usuario");
    vi.useRealTimers();
  });

  it("reintenta ante un error transitorio de getDoc y tiene éxito en un intento posterior, en vez de abortar todo el bucle", async () => {
    vi.useFakeTimers();
    (getDoc as Mock)
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(fakeSnapshot(true, validDocData));

    const pending = getUserProfile("uid-1");
    await vi.runAllTimersAsync();
    const profile = await pending;

    expect(getDoc).toHaveBeenCalledTimes(2);
    expect(profile).toEqual({ uid: "uid-1", ...validDocData });
    vi.useRealTimers();
  });

  it("si un intento intermedio falla pero el SIGUIENTE encuentra el documento, no queda ningún error residual", async () => {
    vi.useFakeTimers();
    (getDoc as Mock)
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(fakeSnapshot(false))
      .mockResolvedValueOnce(fakeSnapshot(true, validDocData));

    const pending = getUserProfile("uid-1");
    await vi.runAllTimersAsync();
    const profile = await pending;

    expect(getDoc).toHaveBeenCalledTimes(3);
    expect(profile).toEqual({ uid: "uid-1", ...validDocData });
    vi.useRealTimers();
  });
});

describe("usersService.createUserProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (setDoc as Mock).mockResolvedValue(undefined);
  });

  it("escribe el documento en users/{uid}", async () => {
    await createUserProfile("uid-1", { email: "hernan@example.com", displayName: "Hernán" });

    expect(doc).toHaveBeenCalledWith(db, "users", "uid-1");
  });

  it("fija role: 'customer' siempre, sin importar qué reciba como input", async () => {
    await createUserProfile("uid-1", { email: "hernan@example.com", displayName: "Hernán" });

    const [, payload] = (setDoc as Mock).mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.role).toBe("customer");
  });

  it("usa serverTimestamp() para createdAt, no un Date armado en el cliente", async () => {
    await createUserProfile("uid-1", { email: "hernan@example.com", displayName: "Hernán" });

    expect(serverTimestamp).toHaveBeenCalled();
    const [, payload] = (setDoc as Mock).mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.createdAt).toEqual({ __type: "serverTimestamp" });
  });

  it("acepta displayName null (usuario sin nombre para mostrar)", async () => {
    await createUserProfile("uid-1", { email: "hernan@example.com", displayName: null });

    const [, payload] = (setDoc as Mock).mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.displayName).toBeNull();
  });

  it("llama a setDoc una sola vez por creación de perfil", async () => {
    await createUserProfile("uid-1", { email: "hernan@example.com", displayName: "Hernán" });

    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it("usa el uid exacto recibido para construir la referencia del documento, sin importar cuál sea", async () => {
    await createUserProfile("otro-uid-distinto", { email: "otra@example.com", displayName: "Otra Persona" });

    expect(doc).toHaveBeenCalledWith(db, "users", "otro-uid-distinto");
  });

  it("propaga un Error legible si setDoc falla con un Error real", async () => {
    (setDoc as Mock).mockRejectedValueOnce(new Error("network-request-failed"));

    await expect(
      createUserProfile("uid-1", { email: "hernan@example.com", displayName: null })
    ).rejects.toThrow("network-request-failed");
  });

  it("envuelve en un Error genérico si setDoc falla con algo que no es un Error", async () => {
    (setDoc as Mock).mockRejectedValueOnce("fallo desconocido");

    await expect(
      createUserProfile("uid-1", { email: "hernan@example.com", displayName: null })
    ).rejects.toThrow("Error desconocido al crear el perfil de usuario");
  });
});

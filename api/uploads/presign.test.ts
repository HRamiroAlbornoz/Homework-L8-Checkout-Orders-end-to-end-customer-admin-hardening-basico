import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Tests de la Vercel Function que firma las subidas a S3.
//
// POR QUÉ ESTE ARCHIVO EXISTE
// ---------------------------
// El resto de la suite NO cubre esta función. Los tests del formulario de admin
// usan MSW, que intercepta la request HTTP y devuelve una respuesta falsa: el
// código de acá nunca llega a ejecutarse. Esos tests verifican el contrato entre
// el frontend y el endpoint; este verifica el endpoint.
//
// La diferencia no es teórica. Sin estos tests, borrar la comprobación de
// audiencia del token o el chequeo de rol admin pasaría el CI en verde.
//
// QUÉ SE MOCKEA Y POR QUÉ
// -----------------------
// - "jose": para poder simular un token válido, uno inválido y —lo más difícil
//   de reproducir de otro modo— una caída de las claves públicas de Google.
//   Los errores de jose se dejan REALES, porque el código distingue entre ellos
//   con instanceof: si se mockearan, el test pasaría por el camino equivocado.
// - "getSignedUrl": para no firmar de verdad ni depender de credenciales.
// - fetch: es la llamada a la API REST de Firestore. Se controla su respuesta
//   para simular cada estado del servidor.

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    createRemoteJWKSet: vi.fn(() => ({})),
    jwtVerify: vi.fn(),
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(),
}));

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { errors as joseErrors, jwtVerify } from "jose";
import { POST } from "./presign.js";

const PROJECT_ID = "proyecto-test";
const UID = "uid-de-prueba";
const FIRMA_FALSA = "https://bucket-test.s3.us-east-1.amazonaws.com/products/x.png?X-Amz-Signature=falsa";

interface RequestOptions {
  conToken?: boolean;
  headerCrudo?: string;
  body?: unknown;
}

function crearRequest({ conToken = true, headerCrudo, body }: RequestOptions = {}): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (headerCrudo !== undefined) {
    headers.Authorization = headerCrudo;
  } else if (conToken) {
    headers.Authorization = "Bearer token-de-prueba";
  }

  return new Request("https://ejemplo.test/api/uploads/presign", {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? { contentType: "image/png", size: 1024 }),
  });
}

/** Simula la respuesta de la API REST de Firestore al leer el perfil. */
function simularFirestore(status: number, body?: unknown): void {
  vi.mocked(globalThis.fetch).mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );
}

function perfilConRol(role: string): unknown {
  return { fields: { role: { stringValue: role } } };
}

beforeEach(() => {
  vi.stubEnv("VITE_FIREBASE_PROJECT_ID", PROJECT_ID);
  vi.stubEnv("S3_REGION", "us-east-1");
  vi.stubEnv("S3_BUCKET", "bucket-test");
  vi.stubEnv("S3_ACCESS_KEY_ID", "clave-falsa");
  vi.stubEnv("S3_SECRET_ACCESS_KEY", "secreto-falso");
  vi.stubGlobal("fetch", vi.fn());

  // Por defecto: token válido, usuario admin, firma exitosa. Cada test cambia
  // solo la pieza que le interesa.
  vi.mocked(jwtVerify).mockResolvedValue({ payload: { sub: UID } } as never);
  vi.mocked(getSignedUrl).mockResolvedValue(FIRMA_FALSA);
  simularFirestore(200, perfilConRol("admin"));

  // El código avisa por consola en los caminos de error. Se silencia para que la
  // salida de la suite quede limpia; los tests que lo necesitan lo verifican.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("presign — identidad (401)", () => {
  it("rechaza la request si no viene el header Authorization", async () => {
    const response = await POST(crearRequest({ conToken: false }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("rechaza el header si no usa el esquema Bearer", async () => {
    const response = await POST(crearRequest({ headerCrudo: "Basic dXN1YXJpbzpjbGF2ZQ==" }));

    expect(response.status).toBe(401);
  });

  it("rechaza un token con firma inválida", async () => {
    vi.mocked(jwtVerify).mockRejectedValue(new joseErrors.JWSSignatureVerificationFailed());

    const response = await POST(crearRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("rechaza un token vencido", async () => {
    vi.mocked(jwtVerify).mockRejectedValue(new joseErrors.JWTExpired("expirado", {}));

    const response = await POST(crearRequest());

    expect(response.status).toBe(401);
  });

  it("verifica el token contra el emisor y la audiencia de ESTE proyecto", async () => {
    await POST(crearRequest());

    // Sin estas dos comprobaciones, un token perfectamente firmado por Google
    // pero emitido para OTRO proyecto de Firebase pasaría como válido.
    expect(jwtVerify).toHaveBeenCalledWith(
      "token-de-prueba",
      expect.anything(),
      {
        issuer: `https://securetoken.google.com/${PROJECT_ID}`,
        audience: PROJECT_ID,
      },
    );
  });
});

describe("presign — permisos (403)", () => {
  it("rechaza a un usuario con rol customer", async () => {
    simularFirestore(200, perfilConRol("customer"));

    const response = await POST(crearRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rechaza a un usuario autenticado que todavía no tiene perfil", async () => {
    // Caso borde real: la cuenta existe en Auth pero el documento de perfil no
    // se llegó a crear. No se asume ningún rol por defecto.
    simularFirestore(404);

    const response = await POST(crearRequest());

    expect(response.status).toBe(403);
  });

  it("lee el perfil con el token del usuario, no con credenciales de admin", async () => {
    await POST(crearRequest());

    const [url, opciones] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/projects/${PROJECT_ID}/databases/(default)/documents/users/${UID}`);
    expect((opciones.headers as Record<string, string>).Authorization).toBe("Bearer token-de-prueba");
  });
});

describe("presign — fallos del servidor se reportan como 500, no como culpa del usuario", () => {
  it("responde 500 si Firestore está caído o saturado", async () => {
    // ESTE es el caso que motivó la corrección: antes, un 503 de Firestore se
    // traducía a "No tenés permisos", mandando al usuario a pedir un permiso que
    // ya tiene y dejando el incidente invisible en los registros.
    simularFirestore(503);

    const response = await POST(crearRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: "PRESIGN_FAILED" });
    expect(console.error).toHaveBeenCalled();
  });

  it("responde 500 si el documento de perfil tiene una forma inesperada", async () => {
    simularFirestore(200, { fields: { role: { integerValue: 42 } } });

    const response = await POST(crearRequest());

    expect(response.status).toBe(500);
  });

  it("responde 500 —no 401— si no se pueden descargar las claves públicas de Google", async () => {
    // Un fallo de red al buscar el JWKS no dice nada sobre el token: puede ser
    // perfectamente válido. Responder 401 mandaría al usuario a iniciar sesión
    // de nuevo por un problema que no puede resolver.
    vi.mocked(jwtVerify).mockRejectedValue(new TypeError("fetch failed"));

    const response = await POST(crearRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: "PRESIGN_FAILED" });
  });

  it("responde 500 si se agota el tiempo de espera del JWKS", async () => {
    vi.mocked(jwtVerify).mockRejectedValue(new joseErrors.JWKSTimeout());

    const response = await POST(crearRequest());

    expect(response.status).toBe(500);
  });

  it("nunca expone el detalle técnico del error al cliente", async () => {
    simularFirestore(503);

    const response = await POST(crearRequest());
    const body = (await response.json()) as { message: string };

    expect(body.message).not.toContain("Firestore");
    expect(body.message).not.toContain("503");
  });
});

describe("presign — validación del cuerpo (400)", () => {
  it("rechaza un tipo de archivo fuera de la whitelist", async () => {
    const response = await POST(
      crearRequest({ body: { contentType: "application/x-sh", size: 1024 } }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_UPLOAD" });
  });

  it("rechaza una imagen que supera el tamaño máximo", async () => {
    const response = await POST(
      crearRequest({ body: { contentType: "image/png", size: 6 * 1024 * 1024 } }),
    );

    expect(response.status).toBe(400);
  });

  it("rechaza un cuerpo sin los campos esperados", async () => {
    const response = await POST(crearRequest({ body: { archivo: "foto.png" } }));

    expect(response.status).toBe(400);
  });

  it("no llega a firmar nada si el cuerpo es inválido", async () => {
    await POST(crearRequest({ body: { contentType: "text/html", size: 10 } }));

    expect(getSignedUrl).not.toHaveBeenCalled();
  });
});

describe("presign — camino feliz", () => {
  it("devuelve la URL firmada, la pública y la key", async () => {
    const response = await POST(crearRequest());
    const body = (await response.json()) as { uploadUrl: string; publicUrl: string; key: string };

    expect(response.status).toBe(200);
    expect(body.uploadUrl).toBe(FIRMA_FALSA);
    expect(body.publicUrl).toBe(`https://bucket-test.s3.us-east-1.amazonaws.com/${body.key}`);
  });

  it("genera la key con un UUID y la extensión del contentType, no del cliente", async () => {
    const response = await POST(
      crearRequest({ body: { contentType: "image/webp", size: 2048 } }),
    );
    const body = (await response.json()) as { key: string };

    // El nombre nunca sale de lo que manda el cliente: con "foto.png.html"
    // alguien podría terminar sirviendo HTML desde el dominio del bucket.
    expect(body.key).toMatch(
      /^products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/,
    );
  });

  it("firma con vencimiento corto y con el content-type incluido en la firma", async () => {
    await POST(crearRequest());

    const [, , opciones] = vi.mocked(getSignedUrl).mock.calls[0] as [
      unknown,
      unknown,
      { expiresIn: number; signableHeaders: Set<string> },
    ];

    expect(opciones.expiresIn).toBe(300);
    // Sin esto, el cliente podría subir declarando cualquier tipo y saltearse la
    // whitelist: S3 no tendría con qué comparar.
    expect(opciones.signableHeaders.has("content-type")).toBe(true);
  });
});

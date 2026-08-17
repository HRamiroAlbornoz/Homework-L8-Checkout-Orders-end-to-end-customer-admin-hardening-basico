import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from "jose";
import { z } from "zod";
import {
  ALLOWED_IMAGE_TYPES,
  IMAGE_EXTENSION_BY_TYPE,
  MAX_IMAGE_SIZE_BYTES,
  // La extensión ".js" es obligatoria: el package.json declara "type": "module",
  // así que esta función corre como ESM en Node, y el resolvedor de ESM no
  // completa extensiones. Se escribe ".js" (no ".ts") porque ese es el nombre
  // del archivo YA COMPILADO, que es lo que existe en tiempo de ejecución.
} from "../../src/constants/uploads.js";

// ============================================================================
// POST /api/uploads/presign
//
// Devuelve una URL prefirmada de corta duración para que el navegador suba una
// imagen DIRECTO a S3, sin que las credenciales de AWS salgan nunca del
// servidor.
//
// Por qué este rodeo en vez de subir el archivo al servidor y que él lo reenvíe:
// el servidor firma, pero nunca ve los bytes. La imagen viaja del navegador a S3
// en una sola conexión, sin ocupar memoria ni tiempo de ejecución de la función.
// Y lo más importante: la clave secreta de AWS jamás se expone.
//
// Este archivo vive en api/ y NO en src/. Esa separación es física, no
// decorativa: todo lo que está en src/ termina dentro del bundle que descarga el
// navegador, donde cualquiera puede leerlo. api/ solo corre en el servidor.
//
// POR QUÉ NO SE USA firebase-admin ACÁ
// ------------------------------------
// La opción evidente para verificar el token sería el SDK de Admin de Firebase.
// No se puede: firebase-admin depende de jwks-rsa, que es CommonJS y hace
// require("jose"); jose 6 es solo ESM, y el runtime de las Vercel Functions no
// admite require() de un módulo ESM. El resultado es que la función ni siquiera
// arranca (ERR_REQUIRE_ESM).
//
// Verificar el token con jose directamente elimina ese conflicto (jose es ESM,
// igual que esta función) y además mejora el diseño: para leer el rol se usa la
// API REST de Firestore con el token DEL PROPIO USUARIO, así que quien autoriza
// la lectura son las reglas de seguridad, no un SDK con acceso total. Menos
// privilegio en el camino de la request, y un secreto menos que administrar.
//
// scripts/seed.ts sí sigue usando firebase-admin: corre en tu máquina con Node,
// donde require() de ESM funciona, y ahí sí hace falta saltear las reglas.
// ============================================================================

// Cuánto vive la URL firmada. Corta a propósito: es el tiempo que alguien tiene
// para usarla si llegara a interceptarla. 5 minutos alcanzan de sobra para subir
// una imagen de hasta 5 MB.
const PRESIGN_EXPIRATION_SECONDS = 300;

// Prefijo dentro del bucket. La política del usuario IAM debe limitarse a este
// prefijo: aunque la credencial se filtrara, no podría tocar nada más.
const UPLOAD_KEY_PREFIX = "products";

// Tiempo máximo de espera al leer el perfil desde la API REST de Firestore.
//
// Sin límite, una respuesta que nunca llega mantiene ocupada la invocación
// hasta que Vercel la mata por timeout de plataforma, y el cliente recibe un
// error genérico del proxy en vez del formato { code, message } de esta API.
// Cortar por nuestra cuenta permite responder con un error propio y registrarlo.
const FIRESTORE_READ_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Configuración del servidor
// ---------------------------------------------------------------------------

// Van en DOS schemas separados a propósito, no en uno solo.
//
// La identidad se verifica antes que nada, y para eso solo hace falta el id del
// proyecto. Si todo estuviera junto, una request sin token en un entorno al que
// todavía le faltan las claves de S3 respondería 500 ("algo explotó") en vez de
// 401 ("te falta el token"): un error engañoso que apunta al lugar equivocado.
const firebaseEnvSchema = z.object({
  // Se lee la variable con prefijo VITE_ a propósito, en vez de duplicar el
  // valor en otra. El prefijo significa "este valor es público", no "este valor
  // es solo del cliente": el id del proyecto ya viaja en el bundle del
  // navegador, así que no hay nada que proteger. Duplicarlo en dos variables
  // solo abriría la puerta a que un día no coincidan.
  VITE_FIREBASE_PROJECT_ID: z.string().min(1),
});

// NINGUNA de estas lleva el prefijo VITE_, y eso no es un detalle de estilo:
// Vite reemplaza literalmente por su valor todo lo que empiece con VITE_ al
// construir el bundle. Una clave de AWS con ese prefijo quedaría escrita en
// texto plano dentro de un archivo .js público.
const s3EnvSchema = z.object({
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Verificación del token de Firebase
// ---------------------------------------------------------------------------

// Claves públicas con las que Google firma los ID tokens de Firebase Auth.
//
// createRemoteJWKSet las descarga la primera vez y las mantiene en memoria,
// respetando el cache de la respuesta. Como Vercel reutiliza la misma instancia
// de la función entre requests, el costo se paga una sola vez y no en cada
// invocación. Por eso se crea a nivel de módulo y no dentro del handler.
const firebaseJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

/**
 * Verifica un ID token de Firebase y devuelve el uid del usuario.
 *
 * jwtVerify comprueba tres cosas, y las tres importan:
 * - La FIRMA contra las claves públicas de Google (nadie puede fabricar uno).
 * - La EXPIRACIÓN (un token robado deja de servir en una hora).
 * - El EMISOR y la AUDIENCIA: que el token sea de ESTE proyecto de Firebase y
 *   no de otro cualquiera. Sin este chequeo, un token válido emitido para un
 *   proyecto distinto pasaría como bueno.
 *
 * @throws si el token no es válido. Quien llama lo traduce a un 401.
 */
async function verifyFirebaseIdToken(idToken: string, projectId: string): Promise<string> {
  const { payload } = await jwtVerify(idToken, firebaseJwks, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });

  // "sub" (subject) es el uid del usuario en los ID tokens de Firebase.
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("El token no contiene un uid válido");
  }

  return payload.sub;
}

// Forma de la respuesta de la API REST de Firestore. Los documentos vienen con
// los tipos explícitos ({ stringValue: "admin" } en vez de "admin"), porque el
// formato es el mismo que usa gRPC internamente.
const firestoreUserDocSchema = z.object({
  fields: z.object({
    role: z.object({ stringValue: z.string() }),
  }),
});

/**
 * Lee el rol del usuario desde Firestore usando SU PROPIO token.
 *
 * Detalle importante de seguridad: la request va autenticada como el usuario, no
 * con credenciales de administrador. Eso significa que las reglas de
 * firestore.rules son las que deciden si la lectura se permite — la regla
 * "allow read: if request.auth.uid == uid" es la que la habilita. Si algún día
 * esa regla cambia, este código deja de poder leer, que es exactamente el
 * comportamiento correcto.
 *
 * @returns el rol, o null si el usuario NO TIENE perfil (404).
 * @throws  si no se pudo determinar el rol por un problema del servidor
 *          (Firestore caído, saturado, timeout, red). Quien llama lo traduce a
 *          un 500, no a un 403.
 *
 * Esa distinción es la parte importante de esta función. "El usuario no es
 * admin" y "no pude averiguar si el usuario es admin" son dos situaciones
 * distintas, y confundirlas tiene dos costos: al usuario se le dice que no tiene
 * permisos cuando en realidad se cayó un servicio (un mensaje que lo manda a
 * pedir permisos que ya tiene), y el incidente queda invisible en los registros
 * porque un 403 es una respuesta esperable.
 */
async function readUserRole(uid: string, idToken: string, projectId: string): Promise<string | null> {
  // encodeURIComponent sobre el uid: nunca se concatena un valor de origen
  // externo en una URL sin codificarlo, aunque en este caso venga de un token ya
  // verificado.
  const documentUrl =
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/(default)/documents/users/${encodeURIComponent(uid)}`;

  const response = await fetch(documentUrl, {
    headers: { Authorization: `Bearer ${idToken}` },
    // Si se agota el tiempo, fetch rechaza con un TimeoutError que se propaga
    // hasta el catch general: 500 y queda registrado.
    signal: AbortSignal.timeout(FIRESTORE_READ_TIMEOUT_MS),
  });

  // 404 es el único "no" legítimo: el usuario existe en Auth pero todavía no
  // tiene documento de perfil. No tiene rol, y por lo tanto no es admin.
  if (response.status === 404) {
    return null;
  }

  // Cualquier otro fallo (429, 500, 503, o un 403 —que significaría que las
  // reglas ya no permiten leer el perfil propio, o sea una configuración rota—)
  // es un problema del servidor, no del usuario.
  if (!response.ok) {
    throw new Error(
      `Firestore respondió ${response.status} al leer el perfil del usuario`,
    );
  }

  const body: unknown = await response.json();
  const parsed = firestoreUserDocSchema.safeParse(body);

  // El documento existe pero no tiene la forma esperada: es un dato inconsistente
  // en la base, no un usuario sin permisos.
  if (!parsed.success) {
    throw new Error("El documento de perfil no tiene la forma esperada");
  }

  return parsed.data.fields.role.stringValue;
}

// ---------------------------------------------------------------------------
// Respuestas de error
// ---------------------------------------------------------------------------

// Formato consistente { code, message, details? }: el "code" es el contrato
// estable que puede leer el frontend, el "message" es el texto humano. Nunca se
// incluye el error original — sus mensajes pueden revelar nombres de buckets,
// rutas internas o detalles de las reglas de seguridad.
function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, string>,
): Response {
  return Response.json(details ? { code, message, details } : { code, message }, { status });
}

// Los distintos motivos por los que una subida se rechaza por datos inválidos.
//
// Van como "details.kind" y NO como códigos de error separados. La diferencia
// importa: el "code" es el contrato que consume el frontend para decidir qué
// hacer, y ahí conviene tener pocas clases generales — quien recibe un
// INVALID_UPLOAD siempre reacciona igual (mostrar el mensaje, no reintentar).
// El "kind" es para quien diagnostica: distingue "el formato está mal" de "pesa
// demasiado" sin obligar al cliente a conocer una lista de códigos que crece.
//
// El síntoma que arregla esto: los cinco motivos devolvían exactamente el mismo
// mensaje y el mismo código, así que un reporte de "no me deja subir la imagen"
// no se podía diagnosticar ni con la respuesta ni con los registros.
type InvalidUploadKind = "CONTENT_TYPE" | "SIZE" | "INVALID_SIZE" | "MALFORMED_BODY";

const MAX_IMAGE_SIZE_MB = MAX_IMAGE_SIZE_BYTES / (1024 * 1024);

// El texto sale del mismo valor que usa la validación: si mañana cambia el
// límite, el mensaje cambia solo. Un mensaje que anuncia un límite distinto del
// que se aplica es peor que no tener mensaje.
const INVALID_UPLOAD_MESSAGES: Record<InvalidUploadKind, string> = {
  CONTENT_TYPE: "La imagen debe ser JPG, PNG o WebP.",
  SIZE: `La imagen no puede pesar más de ${MAX_IMAGE_SIZE_MB} MB.`,
  // Un archivo de 0 bytes NO es un archivo demasiado grande, y decirle eso al
  // usuario lo manda a buscar una imagen más chica cuando el problema es el
  // contrario. Pasa de verdad: una descarga cortada o un archivo dañado tienen
  // nombre y extensión correctos, y el navegador los deja elegir igual.
  INVALID_SIZE: "El archivo de imagen está vacío o dañado. Probá con otro.",
  MALFORMED_BODY: "No pudimos leer los datos de la imagen. Actualizá la página e intentá de nuevo.",
};

function invalidUploadResponse(kind: InvalidUploadKind): Response {
  return errorResponse(400, "INVALID_UPLOAD", INVALID_UPLOAD_MESSAGES[kind], { kind });
}

// ---------------------------------------------------------------------------
// Cuerpo de la request
// ---------------------------------------------------------------------------

// No se pide el nombre del archivo, y es deliberado: el nombre original del
// cliente no se usa para nada (la key se genera con un UUID y la extensión sale
// del contentType ya validado). Un dato que no se usa es un dato que no hace
// falta recibir, y todo lo que se recibe hay que validarlo.
const presignRequestSchema = z.object({
  contentType: z.enum(ALLOWED_IMAGE_TYPES),
  size: z.number().int().positive().max(MAX_IMAGE_SIZE_BYTES),
});

// El tipo se deriva del propio schema en vez de nombrar un tipo de Zod a mano:
// así no hay nada que actualizar si el schema cambia.
type PresignIssues = z.ZodError<z.infer<typeof presignRequestSchema>>["issues"];

/**
 * Traduce los problemas que encontró Zod al motivo concreto del rechazo.
 *
 * Si fallan LOS DOS campos, el cuerpo no tiene la forma esperada en absoluto
 * (un body vacío, o el de otra versión del cliente): eso es MALFORMED_BODY y no
 * "el formato de imagen está mal", que apuntaría al lugar equivocado a quien
 * esté diagnosticando.
 */
function kindFromIssues(issues: PresignIssues): InvalidUploadKind {
  const camposConError = new Set(issues.map((issue) => issue.path[0]));

  if (camposConError.has("contentType") && camposConError.has("size")) {
    return "MALFORMED_BODY";
  }
  if (camposConError.has("contentType")) {
    return "CONTENT_TYPE";
  }

  if (camposConError.has("size")) {
    // No alcanza con saber QUÉ campo falló: hay que saber POR QUÉ. "too_big" es
    // un archivo que se pasa del límite; "too_small" es uno de 0 bytes (o un
    // número negativo, que solo puede venir de una request fabricada a mano).
    // Los dos casos son del mismo campo y necesitan mensajes opuestos.
    const problemaDelTamano = issues.find((issue) => issue.path[0] === "size");

    if (problemaDelTamano?.code === "too_big") {
      return "SIZE";
    }
    if (problemaDelTamano?.code === "too_small") {
      return "INVALID_SIZE";
    }
    // Cualquier otra cosa (un string donde iba un número, un decimal) significa
    // que el cliente no está mandando lo que este endpoint espera.
    return "MALFORMED_BODY";
  }

  // Ningún campo conocido falló: el cuerpo no era ni siquiera un objeto.
  return "MALFORMED_BODY";
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// Firma estándar de la Web (Request → Response). Al exportar la función con el
// nombre del método HTTP, Vercel enruta solo los POST acá y responde 405 al
// resto por su cuenta: no hace falta chequear el método a mano.
export async function POST(request: Request): Promise<Response> {
  try {
    const { VITE_FIREBASE_PROJECT_ID: projectId } = firebaseEnvSchema.parse(process.env);

    // --- 1. Identidad: ¿quién sos? -----------------------------------------
    const authorizationHeader = request.headers.get("authorization");
    if (authorizationHeader === null || !authorizationHeader.startsWith("Bearer ")) {
      return errorResponse(401, "UNAUTHENTICATED", "Falta el token de autenticación.");
    }

    const idToken = authorizationHeader.slice("Bearer ".length);

    let uid: string;
    try {
      uid = await verifyFirebaseIdToken(idToken, projectId);
    } catch (error) {
      // No todo fallo al verificar significa "el token es malo".
      //
      // Para comprobar la firma hay que descargar las claves públicas de Google.
      // Si esa descarga falla (Google caído, un problema de red desde la
      // función, o un timeout), el token puede ser perfectamente válido: lo que
      // falló es la infraestructura. Responder 401 "Iniciá sesión de nuevo"
      // mandaría al usuario a hacer algo que no puede arreglar el problema, y
      // encima el incidente quedaría escondido detrás de un código de estado que
      // parece normal.
      //
      // jose lanza sus propios errores (JOSEError) cuando el token no cumple:
      // firma inválida, vencido, emisor o audiencia equivocados. Cualquier otra
      // cosa —un TypeError de fetch, por ejemplo— no vino del token.
      const esProblemaDeInfraestructura =
        !(error instanceof joseErrors.JOSEError) || error instanceof joseErrors.JWKSTimeout;

      if (esProblemaDeInfraestructura) {
        // Se relanza para que lo tome el catch general: 500 y queda registrado.
        throw error;
      }

      // Token inválido de verdad. Se registra igual —con el código del error de
      // jose, nunca con el token— porque una ráfaga de estos puede ser el
      // síntoma de alguien probando tokens fabricados.
      console.warn("[presign] Token rechazado:", (error as { code?: string }).code ?? "sin código");
      return errorResponse(401, "INVALID_TOKEN", "Tu sesión no es válida. Iniciá sesión de nuevo.");
    }

    // --- 2. Permiso: ¿podés hacer esto? ------------------------------------
    // 401 y 403 son cosas distintas: 401 es "no sé quién sos", 403 es "sé quién
    // sos y no te alcanza". Devolver siempre 401 obligaría al cliente a mandar
    // al usuario a iniciar sesión de nuevo por un problema que no se arregla
    // volviendo a loguearse.
    //
    // El rol se lee de Firestore y no del token: los roles son una decisión de
    // negocio de esta app, viven en su base de datos, y así se puede cambiar el
    // rol de alguien sin tocar el sistema de autenticación.
    const role = await readUserRole(uid, idToken, projectId);
    if (role !== "admin") {
      return errorResponse(403, "FORBIDDEN", "No tenés permisos para subir imágenes.");
    }

    // --- 3. Datos: ¿lo que mandás tiene sentido? ---------------------------
    // request.json() lanza si el cuerpo no es JSON válido. Antes esa excepción
    // caía en el catch general y se respondía 500: un error del cliente
    // reportado como falla del servidor, que además ensucia los registros con
    // incidentes que no lo son.
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return invalidUploadResponse("MALFORMED_BODY");
    }

    const parsedBody = presignRequestSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return invalidUploadResponse(kindFromIssues(parsedBody.error.issues));
    }

    const { contentType, size } = parsedBody.data;

    // --- 4. Firma ----------------------------------------------------------
    const s3Env = s3EnvSchema.parse(process.env);

    // El nombre del archivo se genera acá con un UUID, y la extensión sale del
    // contentType que ya validamos contra la whitelist. Nunca del nombre que
    // mandó el cliente: con "foto.png.html" alguien podría terminar sirviendo
    // HTML desde el dominio del bucket, que es la base de un XSS almacenado.
    // Un UUID además evita que dos admins se pisen los archivos entre sí.
    const objectKey = `${UPLOAD_KEY_PREFIX}/${randomUUID()}.${IMAGE_EXTENSION_BY_TYPE[contentType]}`;

    const s3Client = new S3Client({
      region: s3Env.S3_REGION,
      credentials: {
        accessKeyId: s3Env.S3_ACCESS_KEY_ID,
        secretAccessKey: s3Env.S3_SECRET_ACCESS_KEY,
      },
    });

    const uploadUrl = await getSignedUrl(
      s3Client,
      new PutObjectCommand({
        Bucket: s3Env.S3_BUCKET,
        Key: objectKey,
        ContentType: contentType,
        ContentLength: size,
      }),
      {
        expiresIn: PRESIGN_EXPIRATION_SECONDS,
        // Sin esto, el Content-Type queda FUERA de la firma y el cliente podría
        // subir el archivo declarando cualquier tipo, salteándose la whitelist.
        // Con la cabecera firmada, S3 rechaza el PUT si el Content-Type que
        // manda el navegador no es exactamente el que se firmó acá.
        signableHeaders: new Set(["content-type"]),
      },
    );

    return Response.json({
      uploadUrl,
      publicUrl: `https://${s3Env.S3_BUCKET}.s3.${s3Env.S3_REGION}.amazonaws.com/${objectKey}`,
      key: objectKey,
    });
  } catch (error) {
    // Se loguea el error completo del lado del servidor (queda en los logs de
    // Vercel, donde solo lo ve el equipo) y al cliente le llega un mensaje
    // genérico. Nunca al revés: el mensaje de una excepción puede contener el
    // nombre del bucket, rutas internas o parte de la configuración.
    //
    // Nunca se loguea el cuerpo de la request ni el token: contienen datos que
    // no deben quedar escritos en ningún registro.
    console.error("[presign] Error al generar la URL de subida", error);
    return errorResponse(
      500,
      "PRESIGN_FAILED",
      "No pudimos preparar la subida de la imagen. Intentá de nuevo.",
    );
  }
}

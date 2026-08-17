import { z } from "zod";
import { PRESIGN_ENDPOINT } from "@/constants/uploads";
import { auth } from "@/lib/firebase";

// La respuesta de la función es un dato externo como cualquier otro, aunque el
// código de esa función esté en este mismo repositorio: en producción viaja por
// la red, y una versión desplegada vieja podría devolver otra forma. Se valida.
const presignResponseSchema = z.object({
  uploadUrl: z.url(),
  publicUrl: z.url(),
  key: z.string().min(1),
});

// Forma de los errores que devuelve la función: { code, message }. Se reutiliza
// el "message" que ya viene traducido y pensado para mostrarse, en vez de
// inventar un mensaje nuevo en el cliente que después diga otra cosa.
const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

/**
 * Extrae el mensaje de error de una respuesta fallida de la API.
 *
 * Si el cuerpo no tiene la forma esperada (por ejemplo, un 502 del proxy que
 * devuelve HTML), se usa el mensaje de reserva en vez de romper: un error dentro
 * del manejo de errores deja al usuario sin ninguna explicación.
 */
async function readApiErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    const parsed = apiErrorSchema.safeParse(body);
    return parsed.success ? parsed.data.message : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Sube una imagen de producto y devuelve su URL pública.
 *
 * El flujo son dos requests encadenadas:
 *
 *   1. POST /api/uploads/presign  → el servidor valida quién sos y qué querés
 *                                   subir, y devuelve una URL firmada.
 *   2. PUT  <uploadUrl>           → el navegador sube el archivo DIRECTO a S3.
 *
 * El archivo nunca pasa por nuestro servidor, y la clave secreta de AWS nunca
 * llega al navegador. Cada lado sabe solo lo que necesita.
 *
 * @throws Error con un mensaje listo para mostrarle al usuario.
 */
export async function uploadProductImage(file: File): Promise<string> {
  const currentUser = auth.currentUser;
  if (currentUser === null) {
    throw new Error("Necesitás iniciar sesión para subir imágenes.");
  }

  // El ID token es la prueba de identidad que la función va a verificar. Lo
  // genera el SDK de Firebase y se renueva solo: nunca se guarda en localStorage
  // ni se transporta a mano.
  const idToken = await currentUser.getIdToken();

  // --- Paso 1: pedir la URL firmada ---
  const presignResponse = await fetch(PRESIGN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    // Solo se manda lo que el servidor necesita para decidir. El nombre del
    // archivo no viaja: la función genera el suyo con un UUID.
    body: JSON.stringify({ contentType: file.type, size: file.size }),
  });

  if (!presignResponse.ok) {
    throw new Error(
      await readApiErrorMessage(
        presignResponse,
        "No pudimos preparar la subida de la imagen. Intentá de nuevo.",
      ),
    );
  }

  // safeParse y no parse: si la respuesta no tiene la forma esperada, el
  // ZodError que lanzaría parse trae como mensaje un volcado en JSON de la lista
  // de problemas — texto para un desarrollador, que acá terminaría dentro del
  // cartel de error que ve el usuario.
  const parsedPresign = presignResponseSchema.safeParse(await presignResponse.json());

  if (!parsedPresign.success) {
    // El detalle técnico va al registro, donde sirve para diagnosticar.
    console.error("[uploadsService] La respuesta del presign no tiene la forma esperada", parsedPresign.error);
    throw new Error("No pudimos preparar la subida de la imagen. Intentá de nuevo.");
  }

  const presign = parsedPresign.data;

  // --- Paso 2: subir el archivo a S3 ---
  const uploadResponse = await fetch(presign.uploadUrl, {
    method: "PUT",
    // Este Content-Type tiene que ser EXACTAMENTE el mismo que el servidor
    // incluyó en la firma. Si difiere aunque sea en mayúsculas, S3 rechaza el
    // PUT con un 403 que no explica el motivo — es la falla más difícil de
    // diagnosticar de todo este flujo.
    headers: { "Content-Type": file.type },
    body: file,
  });

  if (!uploadResponse.ok) {
    // S3 responde con XML, no con nuestro formato { code, message }, así que acá
    // no se intenta leer el cuerpo: el detalle técnico no le sirve al usuario y
    // el XML crudo mucho menos.
    throw new Error("No pudimos subir la imagen. Revisá tu conexión e intentá de nuevo.");
  }

  return presign.publicUrl;
}

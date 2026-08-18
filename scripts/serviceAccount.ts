import { z } from "zod";

// Carga y valida la credencial de servicio de Firebase desde el .env.
//
// Vive en su propio archivo porque la usan DOS scripts: el seed del catálogo y
// la limpieza del script de verificación de reglas. Duplicar el parseo
// significaría duplicar también los mensajes de error, y que un día solo uno de
// los dos se entere de un caso nuevo.

// Solo los tres campos que se usan. Validarlos convierte un fallo críptico de
// OpenSSL ("error:1E08010C:DECODER routines::unsupported") en un mensaje que
// dice exactamente qué falta.
const serviceAccountSchema = z.object({
  project_id: z.string().min(1),
  client_email: z.string().min(1),
  private_key: z.string().min(1),
});

/**
 * Parsea el JSON del service account con un mensaje útil si falla.
 *
 * El error nativo de JSON.parse ("Expected property name or '}' at position 1")
 * describe el síntoma pero no la causa, que casi siempre es la misma: el JSON
 * quedó pegado en varias líneas dentro del .env. El parser de .env de Node lee
 * un par clave=valor POR LÍNEA, así que en ese caso el valor termina siendo
 * apenas "{".
 */
function parseServiceAccountJson(rawJson: string): unknown {
  try {
    return JSON.parse(rawJson);
  } catch {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON no contiene un JSON válido.\n" +
        "Causa más frecuente: el JSON está pegado en varias líneas dentro del .env.\n" +
        "Un archivo .env admite un valor por línea: el JSON tiene que ir COMPLETO en una sola.\n" +
        "Para convertirlo:\n" +
        `  node -e "const fs=require('fs');process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(process.argv[1],'utf8'))))" ruta/al/service-account.json`,
    );
  }
}

export interface CredencialDeServicio {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/**
 * Devuelve la credencial lista para pasarle a cert() del SDK de Admin.
 *
 * @param rawJson  contenido de FIREBASE_SERVICE_ACCOUNT_JSON.
 * @returns        los tres campos que necesita cert(), ya validados.
 * @throws         Error con un mensaje accionable si el JSON está mal armado.
 */
export function loadServiceAccount(rawJson: string): CredencialDeServicio {
  const cuenta = serviceAccountSchema.parse(parseServiceAccountJson(rawJson));

  return {
    projectId: cuenta.project_id,
    clientEmail: cuenta.client_email,
    // Según cómo se haya guardado el JSON, los saltos de línea de la clave
    // pueden quedar como los dos caracteres literales \ y n en vez de saltos
    // reales. Mismo tratamiento que en api/uploads/presign.ts.
    privateKey: cuenta.private_key.replace(/\\n/g, "\n"),
  };
}

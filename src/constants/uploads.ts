// Reglas de la subida de imágenes, compartidas entre el navegador y el servidor.
//
// Este archivo NO importa nada a propósito. Lo consumen dos mundos distintos: el
// bundle de Vite (que entiende el alias "@") y la Vercel Function de api/ (que
// no lo entiende, y lo importa por ruta relativa). Sin dependencias, funciona
// igual en los dos.
//
// Por qué compartirlas en vez de escribirlas dos veces: el navegador valida para
// avisarle al usuario antes de subir 40 MB al pedo, y el servidor valida de
// verdad. Si los dos límites se escribieran por separado, tarde o temprano
// dirían cosas distintas y el usuario recibiría un rechazo del servidor por algo
// que el formulario le había aceptado.

// Endpoint de la Vercel Function que firma la subida.
//
// Vive acá y no en uploadsService.ts por un motivo concreto de testing: los
// handlers de MSW necesitan esta ruta, y los carga el archivo de setup de la
// suite. Si la importaran del service, el setup arrastraría el service entero
// —y con él lib/firebase— ANTES de que los tests puedan mockearlo, y todos los
// vi.mock sobre Firebase dejarían de tener efecto. El archivo de setup no debe
// importar código de la aplicación.
export const PRESIGN_ENDPOINT = "/api/uploads/presign";

// Whitelist, nunca blacklist: se enumera lo permitido en vez de lo prohibido.
// Una blacklist deja pasar todo lo que no se anticipó, y siempre hay algo que no
// se anticipó.
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// Extensión que le corresponde a cada tipo permitido.
//
// La extensión del archivo se deriva SIEMPRE de acá, nunca del nombre que manda
// el cliente. Si se usara el nombre original, alguien podría subir un archivo
// llamado "foto.png.html" y terminar con contenido HTML servido desde el
// dominio del bucket — la base de un ataque de XSS almacenado.
export const IMAGE_EXTENSION_BY_TYPE: Record<AllowedImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

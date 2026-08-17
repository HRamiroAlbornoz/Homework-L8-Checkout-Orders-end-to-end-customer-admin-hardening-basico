import { http, HttpResponse } from "msw";
// Se importa de constants/ y NO del service: este archivo lo carga el setup de
// la suite, y traer el service desde ahí arrastraría lib/firebase antes de que
// los tests puedan mockearlo (ver el comentario en constants/uploads.ts).
import { PRESIGN_ENDPOINT } from "@/constants/uploads";

// URLs falsas que devuelve el handler del presign. Son constantes exportadas
// para que los tests puedan afirmar contra ellas sin repetir el string, y para
// que el handler del PUT sepa a qué URL responder.
//
// Tienen forma de URL real de S3 a propósito: un handler que devolviera
// "http://fake" no ejercitaría el schema de Zod que valida que sea una URL bien
// formada, y el test dejaría pasar un bug que en producción sí rompería.
export const FAKE_UPLOAD_URL =
  "https://test-bucket.s3.us-east-1.amazonaws.com/products/fake-uuid.png";

export const FAKE_PUBLIC_URL =
  "https://test-bucket.s3.us-east-1.amazonaws.com/products/fake-uuid.png";

export const FAKE_OBJECT_KEY = "products/fake-uuid.png";

// Handlers del camino feliz. Los tests que necesiten simular un fallo los
// reemplazan puntualmente con server.use(...), sin tocar este archivo: así el
// caso normal queda declarado una sola vez y cada test solo describe en qué se
// diferencia del normal.
export const handlers = [
  http.post(PRESIGN_ENDPOINT, () =>
    HttpResponse.json({
      uploadUrl: FAKE_UPLOAD_URL,
      publicUrl: FAKE_PUBLIC_URL,
      key: FAKE_OBJECT_KEY,
    }),
  ),

  // S3 responde 200 con el cuerpo vacío a un PUT exitoso.
  http.put(FAKE_UPLOAD_URL, () => new HttpResponse(null, { status: 200 })),
];

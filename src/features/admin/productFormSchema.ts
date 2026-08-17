import { z } from "zod";
import { CATEGORIES } from "@/constants/categories";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  type AllowedImageType,
} from "@/constants/uploads";

// Los ids de categoría salen de CATEGORIES, la única fuente de verdad del
// proyecto. z.enum sobre esa lista hace que agregar una categoría nueva allá la
// habilite acá automáticamente, y que un id inventado se rechace.
const categoryIds = CATEGORIES.map((category) => category.id);

export const productFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio.")
    // El límite de longitud no es cosmético: sin él, alguien puede enviar un
    // string de megabytes y hacer crecer la base sin control.
    .max(120, "El nombre no puede superar los 120 caracteres."),

  categoryId: z.enum(categoryIds as [string, ...string[]], {
    message: "Elegí una categoría de la lista.",
  }),

  price: z
    .number({ message: "El precio es obligatorio." })
    .positive("El precio debe ser mayor a 0.")
    .max(99_999_999, "El precio es demasiado alto.")
    // El dinero no tiene más de dos decimales: no existe forma de cobrar
    // $ 10,555. Sin este límite el formulario aceptaba ese valor y lo guardaba
    // en el catálogo, y a partir de ahí el precio inválido se propagaba solo —
    // el carrito lo copia tal cual y las reglas de Firestore lo dan por bueno,
    // porque comparan contra lo que está guardado.
    //
    // multipleOf y no una comparación de decimales a mano: 0.1 + 0.2 no da 0.3
    // en punto flotante, así que un cálculo casero de "cuántos decimales tiene"
    // falla en casos sueltos. Zod resuelve el resto de forma segura contra ese
    // problema; verificado con 10.555 (rechaza), 10.55, 10.5, 10 y 0.01 (pasan).
    .multipleOf(0.01, "El precio no puede tener más de 2 decimales."),
});

export type ProductFormValues = z.infer<typeof productFormSchema>;

/**
 * Valida el archivo de imagen elegido por el admin.
 *
 * Va aparte del schema de Zod porque un File es un objeto del navegador, no un
 * dato serializable: describirlo con Zod no aportaría nada y solo agregaría
 * ruido.
 *
 * IMPORTANTE: esta validación es de conveniencia, para avisarle al usuario antes
 * de que suba 40 MB al pedo. NO es la protección real. El `type` de un File lo
 * declara el navegador a partir de la extensión, y cualquiera puede renombrar
 * un .exe a .png. La validación que cuenta está en la Vercel Function, que es la
 * que decide si firma la subida o no.
 *
 * @returns el mensaje de error, o null si el archivo es aceptable.
 */
export function validateImageFile(file: File | null): string | null {
  if (file === null) {
    return "Elegí una imagen para el producto.";
  }

  if (!ALLOWED_IMAGE_TYPES.includes(file.type as AllowedImageType)) {
    return "La imagen debe ser JPG, PNG o WebP.";
  }

  // Un archivo de 0 bytes pasa todos los demás chequeos: tiene nombre,
  // extensión y hasta el "type" correcto, porque el navegador lo deduce de la
  // extensión sin mirar el contenido. Ocurre con una descarga que se cortó o un
  // archivo dañado. Sin esta línea, el usuario lo sube, espera, y recién el
  // servidor lo rechaza — dos viajes de red para algo que se sabe acá mismo.
  if (file.size === 0) {
    return "El archivo de imagen está vacío o dañado. Probá con otro.";
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return "La imagen no puede pesar más de 5 MB.";
  }

  return null;
}

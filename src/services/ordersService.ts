import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import type { CartState } from "@/features/cart/types";
import { db } from "@/lib/firebase";
import { ORDER_ERROR_CODES } from "@/lib/orderErrorCodes";
import { mapOrderError, OrderError } from "@/lib/orderErrors";
import { orderItemDocSchema, orderWriteSchema } from "@/types/order";

// Nombres de la colección y de la subcolección en constantes: se usan acá y en
// firestore.rules, y tenerlos escritos a mano en varios lugares es la forma más
// fácil de que un día no coincidan.
export const ORDERS_COLLECTION = "orders";
export const ORDER_ITEMS_SUBCOLLECTION = "items";

/**
 * Crea una orden en Firestore a partir del carrito del usuario.
 *
 * @param userId  uid del usuario autenticado que hace la compra.
 * @param cart    estado actual del carrito (ítems + totales).
 * @returns       el id del documento de la orden recién creada.
 * @throws        OrderError con { code, message, retryable } — nunca un error crudo de Firebase.
 *
 * La orden se guarda en DOS niveles: el documento principal con los datos de la
 * compra, y un documento por línea en la subcolección "items". El motivo no es
 * organizativo sino de seguridad: al ser documentos separados, las reglas de
 * Firestore pueden verificar el precio de cada línea contra el catálogo, cosa
 * imposible cuando los ítems eran un array dentro de la orden (ver el comentario
 * completo en types/order.ts y la regla en firestore.rules).
 *
 * Los totales NO se escriben. Se calculan al leer, a partir de ítems ya
 * verificados: un total guardado sería un dato que las reglas no pueden
 * comprobar, y era justamente el que se podía falsear.
 */
export async function createOrderFromCart(userId: string, cart: CartState): Promise<string> {
  // Validaciones de negocio ANTES de tocar la red. No es solo eficiencia: si se
  // dejara que Firestore rechace la escritura, el usuario recibiría un error de
  // permisos genérico en vez de saber que su carrito está vacío.
  if (userId.length === 0) {
    throw new OrderError(
      ORDER_ERROR_CODES.INVALID_ORDER,
      "Necesitás iniciar sesión para confirmar la compra.",
    );
  }

  if (cart.items.length === 0) {
    throw new OrderError(
      ORDER_ERROR_CODES.INVALID_ORDER,
      "No podés confirmar una compra con el carrito vacío.",
    );
  }

  try {
    // Un batch en vez de escrituras sueltas: la orden y todas sus líneas entran
    // juntas o no entra ninguna. Sin esto, un corte de red en el medio podría
    // dejar una orden sin sus ítems — un registro de compra sin nada comprado,
    // que además nadie detectaría.
    const batch = writeBatch(db);

    // doc() sin id genera la referencia (y su id) SIN escribir nada todavía.
    // Hace falta tener el id antes del commit para poder colgarle la
    // subcolección de ítems dentro del mismo batch.
    const orderRef = doc(collection(db, ORDERS_COLLECTION));

    // El documento se valida contra el schema antes de escribirlo. Sin este
    // paso, orderWriteSchema quedaría de adorno y el código que escribe podría
    // alejarse de él sin que nadie se entere, hasta que algo falle al leer las
    // órdenes mucho después.
    const orderPayload = orderWriteSchema.parse({
      userId,
      // El estado inicial lo fija el service, nunca lo recibe como parámetro:
      // así no existe ningún camino por el que alguien pueda crear una orden ya
      // marcada como pagada sin haber pagado.
      status: "created",
    });

    batch.set(orderRef, {
      ...orderPayload,
      // serverTimestamp() lo resuelve el SERVIDOR de Firestore, no el navegador.
      // Con new Date() la fecha saldría del reloj del usuario, que puede estar
      // mal configurado o manipulado, y el orden cronológico de las órdenes
      // dejaría de ser confiable.
      createdAt: serverTimestamp(),
    });

    for (const item of cart.items) {
      const itemPayload = orderItemDocSchema.parse({ userId, ...item });

      batch.set(doc(collection(orderRef, ORDER_ITEMS_SUBCOLLECTION)), itemPayload);
    }

    await batch.commit();

    return orderRef.id;
  } catch (error) {
    // Todo lo que salga de Firestore se traduce a un OrderError con mensaje en
    // español. El error original queda en "cause" para poder diagnosticarlo, sin
    // que su texto técnico llegue nunca a la pantalla.
    throw mapOrderError(error);
  }
}

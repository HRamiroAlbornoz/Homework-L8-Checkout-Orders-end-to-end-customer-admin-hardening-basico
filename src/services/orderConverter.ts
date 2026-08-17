import type { FirestoreDataConverter, QueryDocumentSnapshot } from "firebase/firestore";
import { orderDocSchema, type Order, type OrderDoc } from "@/types/order";

/**
 * Traduce entre el documento de Firestore y el tipo de dominio Order.
 *
 * Es "el borde" de la aplicación: el único lugar donde conviven el Timestamp de
 * Firestore y el Date de JavaScript. De acá para adentro, ninguna página, hook
 * ni componente vuelve a ver un Timestamp.
 *
 * Se aplica con .withConverter(orderConverter) sobre la colección o el
 * documento, y a partir de ahí getDocs()/getDoc() devuelven Order ya tipado y
 * validado, sin que el código que consulta tenga que convertir nada.
 */
export const orderConverter: FirestoreDataConverter<Order, OrderDoc> = {
  /**
   * Convierte el documento crudo de Firestore en un Order del dominio.
   *
   * @param snapshot  documento tal como vino de Firestore.
   * @returns         la orden con id incluido y las fechas ya como Date.
   * @throws          ZodError si el documento no tiene la forma esperada.
   */
  fromFirestore(snapshot: QueryDocumentSnapshot<OrderDoc>): Order {
    // ------------------------------------------------------------------
    // serverTimestamps: "estimate" — no es un detalle menor
    // ------------------------------------------------------------------
    //
    // Por defecto, data() devuelve NULL en los campos escritos con
    // serverTimestamp() mientras el servidor todavía no confirmó la escritura.
    // Firestore aplica la escritura localmente primero (para que la UI responda
    // al instante) y recién después la sincroniza; en esa ventana, createdAt no
    // tiene valor real todavía.
    //
    // Con el comportamiento por defecto, el schema fallaría con "se esperaba un
    // Timestamp" justo después de crear una orden — el momento exacto en que el
    // usuario entra a ver su historial. Un bug que además sería intermitente,
    // porque desaparece apenas el servidor responde: casi imposible de
    // reproducir a mano.
    //
    // Con "estimate", Firestore devuelve una estimación basada en el reloj
    // local. Es un valor aproximado que cambia cuando llega el definitivo, y
    // eso está bien acá: solo se usa para mostrar y ordenar en pantalla. El
    // valor que queda guardado en la base sigue siendo el del servidor, que es
    // el que importa.
    const raw = snapshot.data({ serverTimestamps: "estimate" });

    // Se valida aunque snapshot.data() venga tipado como OrderDoc: ese tipo es
    // una PROMESA del compilador, no una garantía de runtime. Firestore no
    // valida nada al leer, así que un documento escrito por una versión anterior
    // de la app, o editado a mano desde la consola, llegaría con cualquier
    // forma. Zod es lo único que lo comprueba de verdad.
    const doc = orderDocSchema.parse(raw);

    return {
      // El id NO es un campo del documento: viaja aparte, en el snapshot.
      id: snapshot.id,
      userId: doc.userId,
      items: doc.items,
      total: doc.total,
      status: doc.status,
      createdAt: doc.createdAt.toDate(),
      // El spread condicional es por "exactOptionalPropertyTypes" (activo en el
      // tsconfig): con ese flag, escribir `updatedAt: undefined` NO es lo mismo
      // que omitir la propiedad, y el compilador lo rechaza. Así, una orden que
      // nunca fue actualizada simplemente no tiene el campo, en vez de tenerlo
      // con valor undefined.
      ...(doc.updatedAt && { updatedAt: doc.updatedAt.toDate() }),
    };
  },

  /**
   * No se usa: este converter es solo de LECTURA.
   *
   * Las escrituras no pasan por acá a propósito. Al crear una orden, createdAt
   * no es un Timestamp sino el valor centinela que devuelve serverTimestamp(),
   * que no encaja en el tipo OrderDoc; hacerlo entrar exigiría una aserción de
   * tipo (`as`), que la guía del proyecto prohíbe. Y al actualizar el estado se
   * mandan solo dos campos, no una orden entera.
   *
   * Por eso ordersService arma los payloads de escritura de forma explícita y
   * los valida con orderWriteSchema (ver ordersService.ts).
   *
   * Lanza en vez de devolver algo vacío: si alguien intenta escribir con una
   * referencia convertida, tiene que enterarse en el acto y no descubrir mucho
   * después que guardó un documento incompleto.
   */
  toFirestore(): never {
    throw new Error(
      "orderConverter es de solo lectura. Para escribir una orden usá las funciones de ordersService.",
    );
  },
};

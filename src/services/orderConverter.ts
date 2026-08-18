import type { DocumentData, FirestoreDataConverter, QueryDocumentSnapshot } from "firebase/firestore";
import { orderDocSchema, type Order, type OrderDoc } from "@/types/order";

/**
 * Arma el objeto de dominio a partir del id y del documento ya validado.
 *
 * @param id   id del documento (llega aparte, no es un campo del documento).
 * @param doc  documento validado contra orderDocSchema.
 * @returns    la orden con las fechas como Date.
 */
function toDomainOrder(id: string, doc: OrderDoc): Order {
  return {
    id,
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
}

/**
 * Convierte un documento en Order, o devuelve null si está corrupto.
 *
 * @param snapshot  documento tal como vino de Firestore.
 * @returns         la orden, o null si no supera la validación.
 *
 * ⚠ POR QUÉ EXISTE ESTA VERSIÓN "BLANDA" ADEMÁS DEL CONVERTER
 *
 * Es defensa en profundidad. Hoy las reglas validan cada ítem por índice (ver
 * firestore.rules), así que una orden con `items: [1, 2, 3]` se rechaza al
 * escribirla — está comprobado contra Firestore real en `npm run verify:rules`.
 * Pero eso no alcanza para confiar el listado a la validación estricta:
 *
 *   · Pueden existir documentos escritos ANTES de que esa regla existiera. En
 *     este proyecto los hubo: la primera versión de la rama los aceptaba.
 *   · Las reglas se despliegan aparte del código. Un entorno con reglas viejas
 *     corre este mismo bundle.
 *   · El tope de 10 ítems es el techo de get() de Firestore, no una decisión de
 *     producto. Si algún día hay que bajarlo, la verificación por índice se
 *     acorta y vuelve a haber posiciones sin validar.
 *
 * Lo que está en juego si un documento inválido llega a un listado estricto: ESE
 * ÚNICO documento haría fallar la consulta entera, y como las reglas prohíben
 * borrar órdenes, quedaría roto para siempre — su propio historial y, peor, el
 * listado sin filtrar del panel de administración.
 *
 * Por eso los listados omiten los documentos inválidos en vez de romperse. No se
 * silencian: se registran en la consola con su id, para poder diagnosticarlos.
 * En una aplicación con monitoreo, esa línea iría a un servicio de seguimiento
 * de errores en lugar de a la consola.
 *
 * La lectura de UNA orden puntual (getOrderById) sigue usando el converter
 * estricto: ahí, un documento roto tiene que fallar de forma visible, porque
 * devolver null se leería como "no existe" y ocultaría el problema.
 */
export function parseOrderSnapshot(snapshot: QueryDocumentSnapshot<DocumentData>): Order | null {
  const resultado = orderDocSchema.safeParse(snapshot.data({ serverTimestamps: "estimate" }));

  if (!resultado.success) {
    console.error(
      `[orders] El documento ${snapshot.id} tiene una forma inválida y se omitió del listado.`,
      resultado.error.issues,
    );

    return null;
  }

  return toDomainOrder(snapshot.id, resultado.data);
}

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
    //
    // Acá se usa .parse() (que lanza) y no .safeParse(): este camino lo usa la
    // lectura de UNA orden puntual, donde un documento roto tiene que fallar de
    // forma visible. Para los LISTADOS existe parseOrderSnapshot(), que omite
    // los inválidos en vez de tirar abajo la consulta entera.
    return toDomainOrder(snapshot.id, orderDocSchema.parse(raw));
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

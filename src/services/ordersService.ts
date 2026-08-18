import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { FirebaseError } from "firebase/app";
import type { CartState } from "@/features/cart/types";
import { canTransition } from "@/features/orders/orderTransitions";
import { db } from "@/lib/firebase";
import { ORDER_ERROR_CODES } from "@/lib/orderErrorCodes";
import { mapOrderError, OrderError } from "@/lib/orderErrors";
import {
  MAX_ITEMS_PER_ORDER,
  orderWriteSchema,
  type Order,
  type OrderItemSnapshot,
  type OrderStatus,
} from "@/types/order";
import { orderConverter, parseOrderSnapshot } from "./orderConverter";

// El nombre de la colección en una constante: se usa acá y en firestore.rules,
// y tenerlo escrito a mano en varios lugares es la forma más fácil de que un día
// no coincidan.
export const ORDERS_COLLECTION = "orders";

// Referencia a la colección para las CONSULTAS DE LISTADO.
//
// A propósito NO lleva el converter. El converter valida con .parse(), que lanza
// ante un documento con forma inválida — y en un listado, un solo documento roto
// haría fallar la consulta entera.
//
// Eso no es hipotético: las reglas no pueden validar los elementos de un array,
// así que cualquier usuario autenticado puede escribir una orden con
// `items: [1, 2, 3]` desde la consola del navegador. Con el converter estricto,
// eso dejaría inutilizables su historial y el panel de administración de forma
// PERMANENTE, porque las reglas tampoco permiten borrar órdenes.
//
// Los listados convierten documento por documento con parseOrderSnapshot(), que
// omite los inválidos y los registra.
function ordersCollection() {
  return collection(db, ORDERS_COLLECTION);
}

/**
 * Convierte los documentos de un listado, descartando los que estén corruptos.
 *
 * @param documentos  los snapshots que devolvió la consulta.
 * @returns           solo las órdenes que superaron la validación.
 */
function mapearOrdenesValidas(documentos: QueryDocumentSnapshot[]): Order[] {
  return documentos
    .map((documento) => parseOrderSnapshot(documento))
    .filter((orden): orden is Order => orden !== null);
}

// Referencia a un documento PARA ESCRIBIR: sin converter, porque las escrituras
// mandan payloads explícitos (ver orderConverter.ts para el detalle).
function orderWriteRef(orderId: string) {
  return doc(db, ORDERS_COLLECTION, orderId);
}

/**
 * Genera el id de una orden SIN escribir nada en Firestore.
 *
 * @returns  un id nuevo, único, listo para usarse con createOrderFromCart.
 *
 * Es la base de la idempotencia del checkout. doc() sobre una colección produce
 * una referencia —y su id— del lado del cliente, sin ninguna llamada a la red.
 * El checkout lo genera UNA vez antes del primer intento y lo reutiliza en cada
 * reintento, de modo que reintentar sobrescribe el mismo documento en lugar de
 * crear una orden nueva.
 *
 * Con addDoc() esto sería imposible: el id lo asigna la escritura, así que cada
 * reintento produciría una orden distinta.
 */
export function createOrderId(): string {
  return doc(collection(db, ORDERS_COLLECTION)).id;
}

/**
 * Suma el total de la compra a partir de los ítems ya "fotografiados".
 *
 * @param items  líneas de la orden con su precio de compra y cantidad.
 * @returns      el total, redondeado a dos decimales.
 *
 * Se redondea CADA LÍNEA y después el total. No es lo mismo que redondear solo
 * al final: los números decimales en JavaScript arrastran error (0.1 + 0.2 no da
 * exactamente 0.3), y redondeando línea por línea el total coincide con la suma
 * de los subtotales que el usuario ve en pantalla. Si solo se redondeara el
 * final, podría haber un centavo de diferencia entre lo que se muestra y lo que
 * se cobra — y esa clase de diferencia es imposible de explicarle a nadie.
 */
function calculateTotal(items: readonly OrderItemSnapshot[]): number {
  const sum = items.reduce(
    (accumulated, item) => accumulated + Math.round(item.priceAtPurchase * item.quantity * 100) / 100,
    0,
  );

  return Math.round(sum * 100) / 100;
}

/**
 * Convierte los ítems del carrito en snapshots para guardar en la orden.
 *
 * @param cart  estado actual del carrito.
 * @returns     las líneas con "priceAtPurchase" en lugar de "unitPrice".
 *
 * El renombre no es cosmético: en el carrito el precio es el del catálogo en
 * este momento, y en la orden pasa a ser el precio HISTÓRICO de esa compra. El
 * nombre del campo refleja ese cambio de significado.
 */
function toOrderItems(cart: CartState): OrderItemSnapshot[] {
  return cart.items.map((item) => ({
    productId: item.productId,
    name: item.name,
    priceAtPurchase: item.unitPrice,
    quantity: item.quantity,
  }));
}

/**
 * Crea una orden en Firestore a partir del carrito del usuario.
 *
 * @param userId   uid del usuario autenticado que compra.
 * @param cart     estado actual del carrito.
 * @param orderId  id pre-generado con createOrderId(); se reutiliza en reintentos.
 * @returns        el id de la orden creada (el mismo que se recibió).
 * @throws         OrderError con { code, message, retryable } — nunca un error crudo de Firebase.
 */
export async function createOrderFromCart(
  userId: string,
  cart: CartState,
  orderId: string,
): Promise<string> {
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

  if (cart.items.length > MAX_ITEMS_PER_ORDER) {
    throw new OrderError(
      ORDER_ERROR_CODES.INVALID_ORDER,
      `Una orden no puede tener más de ${MAX_ITEMS_PER_ORDER} productos distintos. Quitá algunos y probá de nuevo.`,
    );
  }

  const items = toOrderItems(cart);

  // El total se calcula acá, NO se toma cart.totalPrice. El carrito vive en
  // localStorage, que el usuario puede editar desde las devtools: usar su total
  // sería confiar en un dato que viene del cliente. Recalcularlo a partir de los
  // ítems no cierra el agujero por completo (los precios de los ítems vienen del
  // mismo lugar), pero elimina la incoherencia de guardar un total que no se
  // corresponde con las líneas de la propia orden.
  const total = calculateTotal(items);

  // El documento se valida contra el schema antes de escribirlo. Sin este paso,
  // orderWriteSchema quedaría de adorno y el código que escribe podría alejarse
  // de él sin que nadie se entere, hasta que algo falle al leer las órdenes
  // mucho después, lejos de la causa.
  //
  // Se usa safeParse y NO parse, aunque esto esté fuera del try. Con parse, un
  // ZodError crudo escaparía sin pasar por mapOrderError, y el usuario vería un
  // error técnico en inglés. Envolverlo simplemente en el try tampoco alcanzaba:
  // mapOrderError no reconoce los errores de Zod, así que caía en UNKNOWN_ERROR
  // con el mensaje "intentá de nuevo en unos minutos" y marcado como
  // reintentable — engañoso, porque reintentar con el mismo carrito falla igual.
  //
  // El caso es alcanzable: alguien con un carrito manipulado en localStorage
  // (por ejemplo, una cantidad mayor al máximo permitido por ítem) llega hasta acá.
  const validacion = orderWriteSchema.safeParse({
    userId,
    items,
    total,
    // El estado inicial lo fija el service, nunca llega como parámetro: así no
    // existe ningún camino por el que alguien cree una orden ya marcada como
    // completada sin haber pasado por el flujo.
    status: "pending",
  });

  if (!validacion.success) {
    throw new OrderError(
      ORDER_ERROR_CODES.INVALID_ORDER,
      "Hay un problema con los datos de tu carrito. Vacialo, volvé a agregar los productos y probá de nuevo.",
      // El detalle técnico queda en "cause" para poder diagnosticarlo, sin que
      // llegue nunca a la pantalla. Y no es reintentable: el mismo carrito
      // volvería a fallar exactamente igual.
      { cause: validacion.error },
    );
  }

  const payload = validacion.data;

  try {
    await setDoc(orderWriteRef(orderId), {
      ...payload,
      // serverTimestamp() lo resuelve el SERVIDOR de Firestore, no el navegador.
      // Con new Date() la fecha saldría del reloj del usuario, que puede estar
      // mal configurado o manipulado, y el orden cronológico del historial
      // dejaría de ser confiable. Las reglas además lo exigen.
      createdAt: serverTimestamp(),
    });

    return orderId;
  } catch (error) {
    // ------------------------------------------------------------------
    // EL REINTENTO SOBRE UNA ORDEN QUE YA SE ESCRIBIÓ
    // ------------------------------------------------------------------
    //
    // Caso borde real de la idempotencia. Si el primer intento SÍ llegó a
    // escribirse y lo que se perdió fue la respuesta (se cortó la red justo
    // después del commit), el usuario ve un error y reintenta. Pero ese
    // segundo setDoc sobre un documento que ya existe deja de ser un "create"
    // para las reglas y pasa a ser un "update" — y el update solo lo puede
    // hacer un admin. El customer recibiría PERMISSION_DENIED por una orden
    // que en realidad se creó bien.
    //
    // Antes de dar el error por bueno, se comprueba si el documento ya está
    // ahí y es suyo. Si lo está, el intento se resuelve como éxito.
    //
    // Se hace solo en el catch, y no como chequeo previo a cada escritura:
    // en el camino feliz no cuesta ninguna lectura extra.
    if (error instanceof FirebaseError && error.code === "permission-denied") {
      const existing = await findOwnOrder(orderId, userId);

      if (existing) {
        return orderId;
      }
    }

    // Todo lo que salga de Firestore se traduce a un OrderError con mensaje en
    // español. El error original queda en "cause" para poder diagnosticarlo, sin
    // que su texto técnico llegue nunca a la pantalla.
    throw mapOrderError(error);
  }
}

/**
 * Busca una orden y confirma que pertenezca al usuario indicado.
 *
 * @param orderId  id de la orden.
 * @param userId   uid del supuesto dueño.
 * @returns        la orden si existe y es suya; null en cualquier otro caso.
 *
 * Nunca lanza: se usa dentro del manejo de un error que ya ocurrió, y ahí un
 * fallo al verificar no debe tapar el error original que se estaba tratando.
 */
async function findOwnOrder(orderId: string, userId: string): Promise<Order | null> {
  try {
    const snapshot = await getDoc(orderWriteRef(orderId).withConverter(orderConverter));

    if (!snapshot.exists()) {
      return null;
    }

    const order = snapshot.data();

    return order.userId === userId ? order : null;
  } catch {
    // El catch vacío está justificado acá y es la única excepción del proyecto:
    // esta función corre DENTRO del catch de createOrderFromCart, donde ya hay
    // un error en curso que sí se va a propagar. Si la verificación falla,
    // "no pude confirmar que exista" es exactamente lo que devolver null
    // significa, y el error original sigue su camino sin quedar oculto.
    return null;
  }
}

/**
 * Órdenes de un usuario, de la más reciente a la más antigua.
 *
 * @param userId  uid del dueño de las órdenes.
 * @returns       sus órdenes ordenadas por fecha descendente.
 * @throws        OrderError.
 *
 * Requiere el índice compuesto (userId ASC, createdAt DESC), declarado en
 * firestore.indexes.json. Sin él, Firestore devuelve FAILED_PRECONDITION y
 * mapOrderError lo traduce a MISSING_INDEX.
 *
 * Ojo con orderBy: los documentos que NO tengan createdAt quedan EXCLUIDOS del
 * resultado, sin error ni aviso. Por eso createdAt es obligatorio al crear y las
 * reglas lo exigen: una orden sin ese campo desaparecería del historial y nadie
 * se enteraría.
 */
export async function getOrdersByUser(userId: string): Promise<Order[]> {
  try {
    const ordersQuery = query(
      ordersCollection(),
      where("userId", "==", userId),
      orderBy("createdAt", "desc"),
    );

    const snapshot = await getDocs(ordersQuery);

    return mapearOrdenesValidas(snapshot.docs);
  } catch (error) {
    throw mapOrderError(error);
  }
}

/**
 * Una orden puntual por su id.
 *
 * @param orderId  id de la orden.
 * @returns        la orden, o null si no existe.
 * @throws         OrderError. En particular PERMISSION_DENIED si la orden es de
 *                 otro usuario y quien consulta no es admin: las reglas no
 *                 distinguen "no existe" de "no es tuya", y eso es deliberado.
 */
export async function getOrderById(orderId: string): Promise<Order | null> {
  try {
    const snapshot = await getDoc(orderWriteRef(orderId).withConverter(orderConverter));

    return snapshot.exists() ? snapshot.data() : null;
  } catch (error) {
    throw mapOrderError(error);
  }
}

/**
 * Listado global de órdenes para el panel de administración.
 *
 * @param filters.status  si se indica, devuelve solo las órdenes en ese estado.
 * @returns               las órdenes ordenadas por fecha descendente.
 * @throws                OrderError.
 *
 * Con filtro requiere el índice compuesto (status ASC, createdAt DESC). Sin
 * filtro alcanza con el índice simple que Firestore crea solo.
 *
 * El orden es SIEMPRE descendente, con y sin filtro. Mantenerlo consistente
 * evita que la lista se reacomode al aplicar un filtro, que desorienta a quien
 * la está mirando.
 */
export async function listOrders(filters: { status?: OrderStatus } = {}): Promise<Order[]> {
  try {
    // Las restricciones se arman en un array porque el filtro es opcional.
    // query() las recibe como argumentos sueltos, así que se expanden con
    // spread: es más claro que duplicar la llamada a query() en un if/else.
    const constraints: QueryConstraint[] = [];

    if (filters.status) {
      constraints.push(where("status", "==", filters.status));
    }

    constraints.push(orderBy("createdAt", "desc"));

    const snapshot = await getDocs(query(ordersCollection(), ...constraints));

    return mapearOrdenesValidas(snapshot.docs);
  } catch (error) {
    throw mapOrderError(error);
  }
}

/**
 * Cambia el estado de una orden. Solo un admin puede hacerlo (lo imponen las reglas).
 *
 * @param orderId     id de la orden a modificar.
 * @param nextStatus  estado al que se la quiere mover.
 * @throws            OrderError si la orden no existe o la transición no está permitida.
 *
 * Lee la orden antes de escribir para validar la transición contra su estado
 * REAL, no contra el que la pantalla del admin tenga en memoria (que puede estar
 * viejo si otra persona la cambió mientras tanto). Esa lectura existe para dar
 * un mensaje entendible: la barrera de verdad son las reglas, que evalúan la
 * transición contra el estado ya confirmado en la base y por lo tanto no tienen
 * la ventana de tiempo que sí tiene este chequeo.
 */
export async function updateOrderStatus(orderId: string, nextStatus: OrderStatus): Promise<void> {
  try {
    const current = await getOrderById(orderId);

    if (!current) {
      throw new OrderError(
        ORDER_ERROR_CODES.INVALID_ORDER,
        "La orden que intentás modificar ya no existe.",
      );
    }

    if (!canTransition(current.status, nextStatus)) {
      throw new OrderError(
        ORDER_ERROR_CODES.INVALID_ORDER,
        "Ese cambio de estado no está permitido para esta orden.",
      );
    }

    // updateDoc y no setDoc: manda SOLO los dos campos que cambian. Un setDoc
    // reescribiría el documento entero y podría pisar items, total o createdAt
    // si el objeto en memoria estuviera incompleto. Además, las reglas usan
    // diff().affectedKeys() para permitir exactamente estos dos campos y nada
    // más: mandar el documento completo haría fallar la escritura.
    await updateDoc(orderWriteRef(orderId), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    throw mapOrderError(error);
  }
}

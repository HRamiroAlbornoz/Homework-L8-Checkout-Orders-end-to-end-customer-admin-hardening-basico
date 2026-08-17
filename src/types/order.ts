import { z } from "zod";
import { Timestamp } from "firebase/firestore";
import { MAX_QUANTITY_PER_ITEM } from "@/features/cart/cartConstants";

// Tope de líneas distintas por orden. No hay ningún requisito de negocio detrás:
// es una defensa. Sin un máximo, alguien que llame al SDK desde la consola del
// navegador podría escribir una orden con 10.000 ítems, acercándose al límite de
// 1 MB por documento de Firestore y encareciendo cada lectura del historial.
// El mismo número se repite en firestore.rules, que es donde se aplica de verdad.
export const MAX_ITEMS_PER_ORDER = 50;

// Largo máximo del nombre del producto guardado en el snapshot. Coincide con el
// límite que firestore.rules ya aplica a products.name.
const PRODUCT_NAME_MAX_LENGTH = 120;

// ============================================================================
// ESTADOS DE LA ORDEN
// ============================================================================
//
// Los cuatro valores son un contrato del enunciado: no se renombran ni se
// agregan. Se declaran con z.enum() y no como z.string() por dos motivos que se
// complementan: en tiempo de compilación TypeScript rechaza un "complete" mal
// escrito, y en runtime .parse() rechaza un documento de Firestore cuyo status
// no sea uno de estos cuatro (por ejemplo, uno editado a mano en la consola).
export const orderStatusSchema = z.enum(["pending", "processing", "completed", "cancelled"]);

export type OrderStatus = z.infer<typeof orderStatusSchema>;

// ============================================================================
// SNAPSHOT DE UN ÍTEM
// ============================================================================
//
// Cada línea de la orden guarda una FOTO del producto al momento de comprarlo,
// no una referencia viva al catálogo.
//
// El campo se llama "priceAtPurchase" y no "price" a propósito: el nombre dice
// que es el precio DE ESE MOMENTO. Si mañana el producto sube de precio, o se
// borra del catálogo, la orden tiene que seguir mostrando qué se compró y a
// cuánto — una orden es un registro histórico, y un historial que cambia solo no
// sirve como evidencia de compra.
//
// Por eso el historial NO se "rehidrata" leyendo products: hacerlo reescribiría
// silenciosamente el pasado cada vez que cambia el catálogo.
export const orderItemSnapshotSchema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1).max(PRODUCT_NAME_MAX_LENGTH),
  priceAtPurchase: z.number().nonnegative(),
  quantity: z.number().int().positive().max(MAX_QUANTITY_PER_ITEM),
});

export type OrderItemSnapshot = z.infer<typeof orderItemSnapshotSchema>;

// ============================================================================
// POR QUÉ LOS ÍTEMS VUELVEN A VIVIR DENTRO DE LA ORDEN
// ============================================================================
//
// El proyecto anterior (L7) guardaba cada ítem como un documento propio en una
// subcolección orders/{id}/items/{itemId}. No era una decisión organizativa:
// las reglas de Firestore NO pueden recorrer un array, pero SÍ pueden leer otros
// documentos con get(). Con un documento por ítem, cada uno tenía su propia
// evaluación de regla y ahí se podía comparar su precio contra el del catálogo,
// lo que impedía comprar más barato editando el localStorage.
//
// El contrato de esta homework exige el modelo opuesto: items[] y total dentro
// del documento de la orden. Se adopta ese modelo, y hay que ser explícito sobre
// lo que cuesta: al volver a un array, esa verificación de precio deja de ser
// posible. Las reglas siguen validando la FORMA (tipos, cantidad de ítems,
// rangos), pero ya no pueden contrastar el precio contra products.
//
// Es un trade-off consciente, no un descuido. Queda documentado en
// docs/ai-notes.md junto con la alternativa descartada.
// ============================================================================

// Validador de Timestamp de Firestore.
//
// Hace falta un z.custom() porque Timestamp es una CLASE del SDK, no un tipo
// primitivo que Zod conozca. La comprobación es "instanceof": si el documento
// trajera un string o un número donde debería haber una fecha, falla acá al leer
// y no más tarde, cuando alguien intente llamar a .toDate() sobre algo que no lo
// tiene y la pantalla se rompa sin explicación.
const firestoreTimestampSchema = z.custom<Timestamp>((value) => value instanceof Timestamp, {
  message: "Se esperaba un Timestamp de Firestore",
});

// ============================================================================
// LA ORDEN EN FIRESTORE  (con Timestamp)
// ============================================================================
//
// Forma exacta del documento tal como vive en la base, SIN el campo "id": el id
// no es un campo del documento, llega aparte vía snapshot.id. Mismo criterio que
// productDocSchema y userDocSchema.
export const orderDocSchema = z.object({
  userId: z.string().min(1),
  // .min(1) no es cosmético: una orden sin ítems es una compra de nada, y sin
  // este límite el checkout podría registrar uno por un bug del carrito.
  items: z.array(orderItemSnapshotSchema).min(1).max(MAX_ITEMS_PER_ORDER),
  total: z.number().nonnegative(),
  status: orderStatusSchema,
  createdAt: firestoreTimestampSchema,
  // updatedAt solo existe después del primer cambio de estado hecho por un
  // admin. Una orden recién creada no lo tiene, y por eso es opcional.
  updatedAt: firestoreTimestampSchema.optional(),
});

export type OrderDoc = z.infer<typeof orderDocSchema>;

// ============================================================================
// LA ORDEN EN LA APLICACIÓN  (con Date)
// ============================================================================
//
// El mismo dato, pero con las fechas ya convertidas a Date y con el id incluido.
//
// Por qué existen dos tipos para "la misma" orden: el SDK modular de Firestore
// SIEMPRE devuelve Timestamp y no ofrece ninguna opción para que devuelva Date
// (la vieja opción timestampsInSnapshots fue eliminada). Si el resto de la app
// usara Timestamp, cada componente que muestre una fecha tendría que acordarse
// de llamar a .toDate(), y el día que se cambie de base de datos habría que
// tocar todas las pantallas.
//
// La conversión se resuelve UNA sola vez en el borde, en el converter de
// Firestore (ver src/services/orderConverter.ts). De ahí para adentro, la app
// solo conoce Date.
export const orderSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  items: z.array(orderItemSnapshotSchema).min(1).max(MAX_ITEMS_PER_ORDER),
  total: z.number().nonnegative(),
  status: orderStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date().optional(),
});

export type Order = z.infer<typeof orderSchema>;

// ============================================================================
// LO QUE EL CLIENTE ESCRIBE
// ============================================================================
//
// El documento menos los campos que resuelve el SERVIDOR.
//
// createdAt y updatedAt se omiten porque, en el momento de escribir, no son
// Timestamp: son el valor centinela que devuelve serverTimestamp(), y Firestore
// recién lo reemplaza por la hora real al confirmar la escritura. Validarlos
// contra orderDocSchema fallaría siempre.
//
// Existe para que ordersService valide el documento ANTES de mandarlo a la red.
// Sin este paso, orderDocSchema quedaría de adorno: el código que escribe podría
// irse alejando del schema sin que nadie se entere, hasta que algo falle al leer
// las órdenes mucho después, lejos de la causa.
export const orderWriteSchema = orderDocSchema.omit({ createdAt: true, updatedAt: true });

export type OrderWrite = z.infer<typeof orderWriteSchema>;

import { z } from "zod";
import { Timestamp } from "firebase/firestore";
import { cartItemSchema } from "@/features/cart/types";

// Estado de la orden. Unión cerrada (z.enum) y no un string libre: los estados
// posibles son un conjunto conocido, y con enum el compilador avisa si alguien
// escribe "payed" o "Paid".
//
// Solo existe "created" por ahora. Los otros dos están declarados porque la
// orden nace con la expectativa de avanzar: dejar el tipo preparado no cuesta
// nada y evita que quien agregue el pago tenga que tocar el schema base.
export const orderStatusSchema = z.enum(["created", "paid", "cancelled"]);

export type OrderStatus = z.infer<typeof orderStatusSchema>;

// ============================================================================
// POR QUÉ LOS ÍTEMS NO VIVEN DENTRO DE LA ORDEN
// ============================================================================
//
// La forma evidente sería guardar la orden como un solo documento con un array
// de ítems y los totales adentro. Se hizo así al principio, y tenía un agujero:
// el precio de cada ítem viajaba desde el navegador y nada lo contrastaba
// contra el catálogo. Alguien que editara su localStorage podía comprar a
// cualquier precio.
//
// Las reglas de Firestore NO pueden recorrer un array ni sumar sus elementos,
// así que ese precio era imposible de verificar mientras los ítems fueran un
// campo de la orden. Pero las reglas SÍ pueden leer otros documentos con get().
//
// De ahí este modelo: cada ítem es su propio documento en una subcolección, y
// por lo tanto tiene su propia evaluación de regla. Ahí sí se puede comparar su
// precio contra el del producto en el catálogo (ver firestore.rules).
//
//   orders/{orderId}                    → { userId, status, createdAt }
//   orders/{orderId}/items/{itemId}     → { userId, productId, name, unitPrice, quantity }
//
// Y los totales dejan de guardarse: se calculan al leer, a partir de ítems ya
// verificados. Lo que no se guarda no se puede falsear — y guardar un total que
// las reglas no podían verificar era exactamente el problema.
// ============================================================================

// Forma del documento de la orden dentro de Firestore, sin "id" (el id no es un
// campo del documento: llega aparte, vía snapshot.id). Mismo criterio que
// productDocSchema y userDocSchema.
export const orderDocSchema = z.object({
  userId: z.string().min(1),
  status: orderStatusSchema,
  createdAt: z.custom<Timestamp>((value) => value instanceof Timestamp, {
    message: "createdAt debe ser un Timestamp de Firestore",
  }),
});

export type OrderDoc = z.infer<typeof orderDocSchema>;

// Una línea de la orden. Es el ítem del carrito más el userId de quien compra.
//
// Se reutiliza cartItemSchema en vez de escribir uno igual: si mañana un ítem
// del carrito suma un campo, la orden se entera sola y no quedan dos
// definiciones que se pisan.
//
// Guardar la foto completa (nombre y precio) y no solo el id del producto es
// deliberado: una orden es un registro histórico. Si dentro de un año cambia el
// precio o se borra el producto del catálogo, la orden tiene que seguir
// mostrando qué se compró y a cuánto.
//
// El userId se repite en cada ítem, y no es descuido. En un writeBatch, las
// reglas de cada documento se evalúan contra el estado ANTERIOR al lote, así que
// una regla que hiciera get() sobre la orden padre fallaría: todavía no existe.
// Con el userId acá, la regla del ítem se valida sola.
export const orderItemDocSchema = cartItemSchema.extend({
  userId: z.string().min(1),
});

export type OrderItemDoc = z.infer<typeof orderItemDocSchema>;

// Forma completa que usa la app, con el id del documento ya incorporado.
export const orderSchema = orderDocSchema.extend({ id: z.string() });

export type Order = z.infer<typeof orderSchema>;

// Lo que el cliente realmente ESCRIBE de la orden: el documento menos
// "createdAt".
//
// createdAt se omite porque en el momento de escribir no es un Timestamp
// todavía: es el sentinel que devuelve serverTimestamp(), y el servidor lo
// resuelve al confirmar la escritura. Validarlo contra orderDocSchema fallaría
// siempre. Mismo criterio que en usersService.ts.
//
// Existe para que ordersService valide el documento ANTES de mandarlo. Sin eso,
// el schema y el código que escribe pueden desincronizarse en silencio: el
// schema queda de adorno y nadie se entera hasta que algo se rompe al leer.
export const orderWriteSchema = orderDocSchema.omit({ createdAt: true });

export type OrderWrite = z.infer<typeof orderWriteSchema>;

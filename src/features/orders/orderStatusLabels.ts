import type { OrderStatus } from "@/types/order";

/**
 * Nombre en español de cada estado, para mostrar en pantalla.
 *
 * Vive separado del estado en sí porque son dos cosas distintas: el valor
 * ("pending") es el CONTRATO que viaja a Firestore y nunca se traduce; la
 * etiqueta ("Pendiente") es texto de interfaz que puede reescribirse sin tocar
 * la base de datos.
 *
 * Se tipa como Record<OrderStatus, string> para que agregar un estado al enum
 * rompa la compilación si nadie le da nombre. Sin eso, el estado nuevo se
 * mostraría en pantalla como "undefined" y solo se descubriría mirando.
 */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pendiente",
  processing: "En preparación",
  completed: "Completada",
  cancelled: "Cancelada",
};

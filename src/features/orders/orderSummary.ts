import type { Order } from "@/types/order";

/**
 * Cuántas unidades tiene la orden en total, sumando las cantidades de cada línea.
 *
 * @param order  la orden a resumir.
 * @returns      la suma de las cantidades de todos sus ítems.
 *
 * No es lo mismo que items.length: una orden con un solo producto comprado tres
 * veces tiene 1 línea y 3 unidades. La distinción importa en la pantalla, donde
 * "3 unidades" describe la compra mejor que "1 producto".
 *
 * Vive acá y no dentro de una página porque lo usan dos: el historial del
 * cliente y el listado del panel de administración.
 */
export function countOrderUnits(order: Order): number {
  return order.items.reduce((total, item) => total + item.quantity, 0);
}

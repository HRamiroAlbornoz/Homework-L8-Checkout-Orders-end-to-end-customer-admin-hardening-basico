import { useCallback } from "react";
import { useAsyncData, type AsyncData } from "@/hooks/useAsyncData";
import { listOrders } from "@/services/ordersService";
import type { Order, OrderStatus } from "@/types/order";

/**
 * Listado global de órdenes para el panel de administración.
 *
 * @param status  estado por el que filtrar, o null para traerlas todas.
 * @returns       estado de la carga (loading/success/error) y una función reload().
 *
 * El filtro se pasa como null —y no como undefined— porque "sin filtro" es una
 * elección explícita del usuario, no un dato que falta. Además, con
 * exactOptionalPropertyTypes activo, pasar `{ status: undefined }` no es lo
 * mismo que omitir la propiedad, y el ternario de abajo evita esa ambigüedad.
 *
 * Cambiar el filtro cambia la dependencia del useCallback, y eso vuelve a
 * disparar la consulta: es exactamente el comportamiento buscado. El filtrado se
 * hace en FIRESTORE (con where), no en memoria sobre una lista ya traída — filtrar
 * en el cliente obligaría a leer todas las órdenes siempre, y cada lectura se cobra.
 */
export function useAdminOrders(status: OrderStatus | null): AsyncData<Order[]> {
  const load = useCallback(() => listOrders(status ? { status } : {}), [status]);

  return useAsyncData(load);
}

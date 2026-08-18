import { useCallback } from "react";
import { useAsyncData, type AsyncData } from "@/hooks/useAsyncData";
import { getOrderById } from "@/services/ordersService";
import type { Order } from "@/types/order";

/**
 * Una orden puntual, para la pantalla de detalle.
 *
 * @param orderId  id de la orden a mostrar.
 * @returns        estado de la carga; el dato es la orden, o null si no existe.
 *
 * Devuelve Order | null y no lanza cuando no existe, porque "no encontrada" no
 * es un fallo del sistema: es un resultado legítimo que la pantalla muestra con
 * su propio mensaje. Un error, en cambio, sí significa que algo salió mal (sin
 * permisos, sin red) y va por el estado "error".
 *
 * Ojo con el caso de una orden ajena: las reglas de Firestore rechazan la
 * lectura con PERMISSION_DENIED en vez de devolver "no existe". Esa distinción
 * llega como error, no como null, y es deliberada — las reglas no revelan si el
 * documento existe.
 */
export function useOrderDetail(orderId: string): AsyncData<Order | null> {
  const load = useCallback(() => getOrderById(orderId), [orderId]);

  return useAsyncData(load);
}

import { useCallback } from "react";
import { useAsyncData, type AsyncData } from "@/hooks/useAsyncData";
import { getOrdersByUser } from "@/services/ordersService";
import type { Order } from "@/types/order";

/**
 * Historial de órdenes del usuario que está en sesión.
 *
 * @param userId  uid del usuario logueado.
 * @returns       estado de la carga (loading/success/error) y una función reload().
 *
 * El useCallback no es opcional: useAsyncData depende de la función que recibe,
 * y una creada en el cuerpo del componente sería un objeto nuevo en cada render,
 * disparando un bucle infinito de consultas a Firestore. Al memorizarla con
 * [userId], solo cambia cuando cambia el usuario — que es exactamente cuando hay
 * que volver a consultar.
 *
 * Se usa getDocs (lectura puntual) y no onSnapshot: el historial de compras no
 * cambia mientras la persona lo está mirando. Un listener abriría una conexión
 * que hay que limpiar y volvería a cobrar lecturas en cada reconexión, sin
 * ningún beneficio.
 */
export function useCustomerOrders(userId: string): AsyncData<Order[]> {
  const load = useCallback(() => getOrdersByUser(userId), [userId]);

  return useAsyncData(load);
}

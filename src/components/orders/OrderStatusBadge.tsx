import { ORDER_STATUS_LABELS } from "@/features/orders/orderStatusLabels";
import type { OrderStatus } from "@/types/order";

interface OrderStatusBadgeProps {
  status: OrderStatus;
}

/**
 * Muestra el estado de una orden como una etiqueta con color.
 *
 * El color acompaña, pero NUNCA es lo que comunica el estado: el texto siempre
 * está presente. Una persona con daltonismo —o cualquiera mirando en una
 * pantalla con mala luz— tiene que poder distinguir "Cancelada" de "Completada"
 * sin depender de si el fondo es rojo o verde. Es la regla de accesibilidad de
 * "no comuniques información solo con color", y acá se cumple sola porque el
 * nombre del estado es el contenido del elemento.
 *
 * Se usa tanto en el historial del customer como en el panel de administración:
 * el mismo estado se ve igual en toda la aplicación.
 */
export function OrderStatusBadge({ status }: OrderStatusBadgeProps) {
  return (
    <span className={`order-status order-status--${status}`}>{ORDER_STATUS_LABELS[status]}</span>
  );
}

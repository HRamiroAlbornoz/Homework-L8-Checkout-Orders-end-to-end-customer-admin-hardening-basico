import { Link } from "react-router";
import { OrderStatusBadge } from "../components/orders/OrderStatusBadge";
import { EmptyState } from "../components/states/EmptyState";
import { ErrorState } from "../components/states/ErrorState";
import { LoadingState } from "../components/states/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import { countOrderUnits } from "../features/orders/orderSummary";
import { useCustomerOrders } from "../features/orders/useCustomerOrders";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { formatDateTime } from "../lib/formatDate";
import { formatPrice } from "../lib/formatPrice";

export function OrdersPage() {
  // Antes de cualquier return temprano: los hooks tienen que ejecutarse siempre,
  // en el mismo orden, en cada render.
  useDocumentTitle("Mis órdenes");

  const { user } = useAuth();

  // ProtectedRoute garantiza que acá siempre hay sesión, pero el tipo de "user"
  // igual admite null. El ?? "" cubre ese hueco del tipo sin agregar un return
  // temprano que rompería el orden de los hooks.
  const orders = useCustomerOrders(user?.uid ?? "");

  // El contenido se arma en una función aparte para no repetir el <h1> en cada
  // uno de los cuatro casos. El encabezado se muestra siempre: si estuviera
  // dentro de cada rama, la pantalla quedaría sin título mientras carga y el
  // usuario no sabría dónde está.
  function renderContent() {
    if (orders.status === "loading") {
      return <LoadingState message="Cargando tus órdenes..." />;
    }

    if (orders.status === "error") {
      return (
        <ErrorState
          message={orders.error.message}
          onRetry={orders.reload}
          retryLabel="Reintentar la carga de tus órdenes"
        />
      );
    }

    if (orders.data.length === 0) {
      return <EmptyState message="Aún no tienes órdenes. Cuando compres algo, va a aparecer acá." />;
    }

    return (
      // role="list" es redundante en teoría, pero necesario en la práctica:
      // cuando una lista lleva "list-style: none" en el CSS, VoiceOver en Safari
      // le quita las semánticas de lista y deja de anunciar "lista de N
      // elementos". Mismo criterio que en CartPage.
      <ul className="orders-list" role="list">
        {orders.data.map((order) => (
          <li key={order.id} className="orders-list__item">
            {/*
              La tarjeta entera es el enlace, y a propósito NO lleva aria-label:
              un aria-label REEMPLAZA el contenido para el lector de pantalla, y
              se perdería el estado, la fecha y el total. Dejando que hable el
              contenido, se anuncia todo: "Orden abc123, Pendiente, 15 de enero
              de 2026 10:00, 3 unidades, $ 250,00".
            */}
            <Link to={`/orders/${order.id}`} className="orders-list__link">
              <span className="orders-list__id">Orden {order.id}</span>

              <OrderStatusBadge status={order.status} />

              {/*
                <time> con dateTime en formato ISO: el texto visible está en
                español y abreviado, pero la máquina lee la fecha exacta y sin
                ambigüedad de zona horaria.
              */}
              <time dateTime={order.createdAt.toISOString()} className="orders-list__date">
                {formatDateTime(order.createdAt)}
              </time>

              <span className="orders-list__units">
                {countOrderUnits(order)} {countOrderUnits(order) === 1 ? "unidad" : "unidades"}
              </span>

              <strong className="orders-list__total">{formatPrice(order.total)}</strong>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="page">
      <h1>Mis órdenes</h1>
      {renderContent()}
    </div>
  );
}

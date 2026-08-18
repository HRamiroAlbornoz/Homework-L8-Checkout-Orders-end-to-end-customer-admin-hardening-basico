import { useEffect, useRef, useState } from "react";
import { OrderStatusBadge } from "../components/orders/OrderStatusBadge";
import { EmptyState } from "../components/states/EmptyState";
import { ErrorState } from "../components/states/ErrorState";
import { LoadingState } from "../components/states/LoadingState";
import { countOrderUnits } from "../features/orders/orderSummary";
import { ORDER_STATUS_LABELS } from "../features/orders/orderStatusLabels";
import { getAllowedTransitions } from "../features/orders/orderTransitions";
import { useAdminOrders } from "../features/orders/useAdminOrders";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { formatDateTime } from "../lib/formatDate";
import { formatPrice } from "../lib/formatPrice";
import { updateOrderStatus } from "../services/ordersService";
import { orderStatusSchema, type Order, type OrderStatus } from "../types/order";

/** Cambio de estado esperando confirmación. */
interface PendingChange {
  order: Order;
  nextStatus: OrderStatus;
}

export function AdminOrdersPage() {
  useDocumentTitle("Órdenes · Panel de administración");

  // null significa "todos los estados". Se distingue del undefined a propósito:
  // "sin filtro" es una elección, no un dato que falta.
  const [statusFilter, setStatusFilter] = useState<OrderStatus | null>(null);

  const orders = useAdminOrders(statusFilter);

  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);

  // Estado POR ÍTEM, no un booleano global. Con un flag compartido, cambiar una
  // fila deshabilitaría toda la tabla y no se vería cuál se está procesando.
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);

  // Confirmación del cambio aplicado. Se anuncia en una región live: sin ella,
  // quien usa un lector de pantalla solo percibe que la confirmación desapareció,
  // sin saber si el cambio se guardó o si se canceló.
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // MANEJO DEL FOCO DE LA CONFIRMACIÓN
  // ---------------------------------------------------------------------------
  //
  // El panel de confirmación se renderiza ARRIBA de la tabla, pero se dispara
  // desde un <select> que está DENTRO de ella. Sin mover el foco, alguien que
  // navega con teclado abre la confirmación y, al seguir tabulando, nunca llega
  // a los botones: quedaron detrás en el orden del documento. La acción sería
  // literalmente inalcanzable sin mouse.
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // Qué <select> abrió la confirmación, para devolverle el foco al cerrarla. Sin
  // esto, cancelar deja el foco en la nada y hay que volver a recorrer la página
  // entera para retomar donde se estaba.
  const triggerRef = useRef<HTMLSelectElement | null>(null);

  // Al confirmar con éxito, la lista se recarga y el <select> que abrió la
  // confirmación deja de existir en el DOM. Devolverle el foco no sirve: es un
  // nodo desprendido, y el foco termina cayendo en el <body> — quien navega con
  // teclado queda en la nada y tiene que tabular desde el principio de la página.
  //
  // Por eso el foco va al encabezado de la sección, que sí sobrevive a la
  // recarga. Necesita tabIndex={-1} para poder recibirlo: los encabezados no son
  // enfocables por defecto, y ese valor lo hace enfocable por código SIN
  // agregarlo al recorrido del tabulador.
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (pendingChange) {
      confirmButtonRef.current?.focus();
    }
  }, [pendingChange]);

  function cerrarConfirmacion(): void {
    setPendingChange(null);
    triggerRef.current?.focus();
  }

  function handleFilterChange(value: string): void {
    if (value === "") {
      setStatusFilter(null);
      return;
    }

    // safeParse en vez de una aserción de tipo: el valor sale del DOM, que es
    // un dato externo. Si alguien edita el <option> desde las devtools, acá se
    // descarta en vez de viajar como un estado inválido hasta Firestore.
    const parsed = orderStatusSchema.safeParse(value);

    if (parsed.success) {
      setStatusFilter(parsed.data);
    }
  }

  function handleSelectNextStatus(order: Order, select: HTMLSelectElement): void {
    const parsed = orderStatusSchema.safeParse(select.value);

    if (parsed.success) {
      setActionError(null);
      setSuccessMessage(null);
      triggerRef.current = select;
      setPendingChange({ order, nextStatus: parsed.data });
    }
  }

  async function handleConfirmChange(): Promise<void> {
    if (!pendingChange) {
      return;
    }

    const { order, nextStatus } = pendingChange;

    setActionError(null);
    setUpdatingOrderId(order.id);

    try {
      await updateOrderStatus(order.id, nextStatus);

      // Los efectos del éxito van DENTRO del try y después del await: si
      // estuvieran en el finally, se cerraría la confirmación y se recargaría la
      // lista incluso cuando la escritura falló.
      setPendingChange(null);
      setSuccessMessage(
        `La orden ${order.id} pasó a ${ORDER_STATUS_LABELS[nextStatus]}.`,
      );

      // El foco se mueve al encabezado de la sección, no al selector que abrió
      // la confirmación: ese selector está por desaparecer con la recarga.
      headingRef.current?.focus();

      // Se recarga desde Firestore en vez de actualizar la fila en memoria. Es
      // una lectura más, pero garantiza que lo que se ve sea lo que quedó
      // guardado — incluido el updatedAt que puso el servidor, que el cliente no
      // conoce. Si hay un filtro activo, la orden puede desaparecer de la lista:
      // es correcto, ya no pertenece al estado filtrado.
      orders.reload();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "No pudimos actualizar la orden.",
      );
    } finally {
      setUpdatingOrderId(null);
    }
  }

  function renderOrders() {
    if (orders.status === "loading") {
      return <LoadingState message="Cargando las órdenes..." />;
    }

    if (orders.status === "error") {
      return (
        <ErrorState
          message={orders.error.message}
          onRetry={orders.reload}
          retryLabel="Reintentar la carga de las órdenes"
        />
      );
    }

    if (orders.data.length === 0) {
      return (
        <EmptyState
          message={
            statusFilter
              ? `No hay órdenes en estado "${ORDER_STATUS_LABELS[statusFilter]}".`
              : "Todavía no hay ninguna orden."
          }
        />
      );
    }

    return (
      // El contenedor con scroll horizontal evita que la tabla desborde la
      // pantalla en un monitor angosto: se desplaza ella sola en vez de estirar
      // la página entera.
      <div className="admin-orders__table-wrapper">
        <table className="admin-orders__table">
          <caption className="visually-hidden">
            Todas las órdenes, de la más reciente a la más antigua
          </caption>
          <thead>
            <tr>
              <th scope="col">Orden</th>
              <th scope="col">Cliente</th>
              <th scope="col">Fecha</th>
              <th scope="col">Unidades</th>
              <th scope="col">Total</th>
              <th scope="col">Estado</th>
              <th scope="col">Cambiar estado</th>
            </tr>
          </thead>
          <tbody>
            {orders.data.map((order) => {
              const allowedTransitions = getAllowedTransitions(order.status);
              const isUpdating = updatingOrderId === order.id;

              return (
                <tr key={order.id}>
                  <td className="admin-orders__id">{order.id}</td>
                  <td className="admin-orders__id">{order.userId}</td>
                  <td>
                    <time dateTime={order.createdAt.toISOString()}>
                      {formatDateTime(order.createdAt)}
                    </time>
                  </td>
                  <td>{countOrderUnits(order)}</td>
                  <td>{formatPrice(order.total)}</td>
                  <td>
                    <OrderStatusBadge status={order.status} />
                  </td>
                  <td>
                    {allowedTransitions.length === 0 ? (
                      // Un estado terminal no ofrece ninguna acción. Se dice con
                      // palabras en vez de dejar la celda vacía: una celda vacía
                      // se lee como "falta algo", no como "no hay nada que hacer".
                      <span className="admin-orders__no-actions">Estado final</span>
                    ) : (
                      <>
                        {/*
                          Cada <select> necesita su propio <label>. Se oculta a la
                          vista porque el encabezado de la columna ya explica de
                          qué se trata, pero un lector de pantalla que salta de
                          control en control no pasa por el encabezado: sin label,
                          anunciaría solo "lista desplegable".
                        */}
                        <label htmlFor={`status-${order.id}`} className="visually-hidden">
                          Cambiar el estado de la orden {order.id}
                        </label>
                        <select
                          id={`status-${order.id}`}
                          // El valor vuelve siempre a "": el <select> acá es un
                          // disparador de acción, no un campo que guarde un
                          // valor. Dejarlo con la opción elegida sugeriría que el
                          // cambio ya se aplicó, cuando todavía falta confirmar.
                          value=""
                          disabled={isUpdating}
                          onChange={(event) => handleSelectNextStatus(order, event.target)}
                        >
                          <option value="">Cambiar a…</option>
                          {/*
                            Solo se ofrecen las transiciones válidas: desde
                            "pending" no aparece "completed". Esto ayuda al
                            usuario, pero NO es la barrera — las reglas de
                            Firestore validan la misma máquina de estados.
                          */}
                          {allowedTransitions.map((nextStatus) => (
                            <option key={nextStatus} value={nextStatus}>
                              {ORDER_STATUS_LABELS[nextStatus]}
                            </option>
                          ))}
                        </select>

                        {isUpdating && (
                          <span role="status" className="admin-orders__updating">
                            Actualizando…
                          </span>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section className="admin-orders">
      {/* tabIndex={-1}: enfocable por código, pero fuera del recorrido del
          tabulador. Es a donde se manda el foco después de un cambio exitoso. */}
      <h2 ref={headingRef} tabIndex={-1}>
        Órdenes
      </h2>

      {successMessage && (
        <p className="admin-orders__success" role="status">
          {successMessage}
        </p>
      )}

      <div className="admin-orders__filter">
        <label htmlFor="filtro-estado">Filtrar por estado</label>
        <select
          id="filtro-estado"
          value={statusFilter ?? ""}
          onChange={(event) => handleFilterChange(event.target.value)}
        >
          <option value="">Todos los estados</option>
          {orderStatusSchema.options.map((status) => (
            <option key={status} value={status}>
              {ORDER_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      {/*
        CONFIRMACIÓN ANTES DE CAMBIAR EL ESTADO.
        En esta máquina de estados NINGUNA transición se puede deshacer: de
        "processing" no se vuelve a "pending", y "completed" y "cancelled" son
        terminales. Por eso se confirma siempre, y el mensaje dice exactamente
        qué orden y qué cambio — un "¿estás seguro?" a secas obligaría a
        recordar de memoria sobre cuál de las filas se hizo clic.
      */}
      {pendingChange && (
        <div
          className="admin-orders__confirm"
          role="alertdialog"
          aria-live="assertive"
          // aria-labelledby apunta al texto que explica el cambio: es lo que un
          // lector de pantalla anuncia como nombre del diálogo. Sin esto diría
          // solo "diálogo de alerta", sin decir de qué.
          aria-labelledby="confirmacion-cambio-estado"
          // Escape cancela, que es lo que espera cualquiera frente a un diálogo.
          // Va acá y no en un listener global: el foco está adentro (lo mueve el
          // efecto de arriba), así que el evento llega por propagación.
          onKeyDown={(event) => {
            if (event.key === "Escape" && updatingOrderId === null) {
              cerrarConfirmacion();
            }
          }}
        >
          {/*
            NO se declara aria-modal="true", a propósito. Ese atributo le dice al
            lector de pantalla que el resto de la página está inerte, y acá no lo
            está: es un panel en línea, sin trampa de foco. Declararlo sería
            mentirle a la tecnología de asistencia. El foco entra al abrir y
            vuelve al <select> al cerrar, que es lo que resuelve el problema real.
          */}
          <p id="confirmacion-cambio-estado">
            Vas a cambiar la orden <strong>{pendingChange.order.id}</strong> de{" "}
            <strong>{ORDER_STATUS_LABELS[pendingChange.order.status]}</strong> a{" "}
            <strong>{ORDER_STATUS_LABELS[pendingChange.nextStatus]}</strong>. Este cambio no se
            puede deshacer.
          </p>

          <div className="admin-orders__confirm-actions">
            <button
              ref={confirmButtonRef}
              type="button"
              className="admin-orders__confirm-yes"
              onClick={handleConfirmChange}
              disabled={updatingOrderId !== null}
            >
              {updatingOrderId !== null ? "Guardando…" : "Sí, cambiar el estado"}
            </button>
            <button
              type="button"
              className="admin-orders__confirm-no"
              onClick={cerrarConfirmacion}
              disabled={updatingOrderId !== null}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {actionError && (
        <p className="admin-orders__error" role="alert">
          {actionError}
        </p>
      )}

      {renderOrders()}
    </section>
  );
}

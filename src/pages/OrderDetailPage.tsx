import { Link, useParams } from "react-router";
import { OrderStatusBadge } from "../components/orders/OrderStatusBadge";
import { EmptyState } from "../components/states/EmptyState";
import { ErrorState } from "../components/states/ErrorState";
import { LoadingState } from "../components/states/LoadingState";
import { useOrderDetail } from "../features/orders/useOrderDetail";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { formatDateTime } from "../lib/formatDate";
import { formatPrice } from "../lib/formatPrice";
import { ORDER_ERROR_CODES } from "../lib/orderErrorCodes";
import { OrderError } from "../lib/orderErrors";

/**
 * Mensaje de error adaptado a esta pantalla.
 *
 * @param error  el error que devolvió la carga.
 * @returns      el texto a mostrar.
 *
 * Un rechazo de permisos acá NO significa lo mismo que en el checkout, y por eso
 * no alcanza con el mensaje genérico del service.
 *
 * Las reglas de Firestore deniegan la lectura en TRES situaciones que desde
 * afuera son indistinguibles: la orden es de otra persona, la orden no existe, o
 * la sesión expiró. En un `get` sobre un documento inexistente, `resource` es
 * null y la condición `resource.data.userId == request.auth.uid` no se puede
 * evaluar, así que la regla deniega igual que si fuera ajena.
 *
 * Esa indistinción es DESEADA: si "no existe" y "no es tuya" dieran errores
 * distintos, alguien podría probar ids al azar y averiguar cuáles corresponden a
 * órdenes reales. Pero el precio es que el mensaje genérico ("tu sesión
 * expiró") le miente a quien simplemente tipeó mal la URL.
 *
 * La solución es un mensaje que cubra las tres causas sin confirmar ninguna.
 */
function describeError(error: Error): string {
  if (error instanceof OrderError && error.code === ORDER_ERROR_CODES.PERMISSION_DENIED) {
    return "No pudimos mostrar esa orden. Puede que el enlace sea incorrecto, que la orden ya no exista, o que pertenezca a otra cuenta.";
  }

  return error.message;
}

export function OrderDetailPage() {
  useDocumentTitle("Detalle de la orden");

  // El nombre "orderId" tiene que coincidir con el del segmento declarado en la
  // ruta (/orders/:orderId). Si no coincide, useParams devuelve undefined y la
  // pantalla mostraría "no encontrada" sin ninguna pista de por qué.
  const { orderId } = useParams<{ orderId: string }>();

  const order = useOrderDetail(orderId ?? "");

  function renderContent() {
    if (order.status === "loading") {
      return <LoadingState message="Cargando la orden..." />;
    }

    if (order.status === "error") {
      return (
        <ErrorState
          message={describeError(order.error)}
          onRetry={order.reload}
          retryLabel="Reintentar la carga de la orden"
        />
      );
    }

    // null significa "el documento no existe".
    //
    // En la práctica esta rama casi nunca se alcanza: se comprobó en el
    // navegador que las reglas deniegan la lectura de un id inexistente (con
    // `resource` en null, la condición del dueño no se puede evaluar), así que
    // ese caso llega como error y lo cubre describeError().
    //
    // Se mantiene igual por dos motivos: getOrderById() declara que puede
    // devolver null y el tipo obliga a contemplarlo, y si algún día las reglas
    // cambian, esta pantalla ya sabe qué mostrar en vez de romperse.
    if (order.data === null) {
      return (
        <EmptyState message="No encontramos esa orden. Puede que el enlace esté mal o que ya no exista." />
      );
    }

    const { items, total, status, createdAt, updatedAt } = order.data;

    return (
      <>
        <dl className="order-detail__meta">
          <div className="order-detail__field">
            <dt>Estado</dt>
            <dd>
              <OrderStatusBadge status={status} />
            </dd>
          </div>

          <div className="order-detail__field">
            <dt>Fecha de compra</dt>
            <dd>
              <time dateTime={createdAt.toISOString()}>{formatDateTime(createdAt)}</time>
            </dd>
          </div>

          {/*
            updatedAt solo existe si un administrador cambió el estado alguna
            vez. Mostrarlo siempre —con un guion o un "—" cuando no hay dato—
            sugeriría que falta información; omitirlo cuando no aplica es más
            honesto.
          */}
          {updatedAt && (
            <div className="order-detail__field">
              <dt>Última actualización</dt>
              <dd>
                <time dateTime={updatedAt.toISOString()}>{formatDateTime(updatedAt)}</time>
              </dd>
            </div>
          )}
        </dl>

        {/*
          Una tabla y no una lista de divs: esto son datos tabulares de verdad
          (cada fila tiene las mismas cuatro columnas). Con <th scope="col">, un
          lector de pantalla anuncia "Producto: Nike Air Max 90, Cantidad: 2" al
          recorrer las celdas, en vez de leer números sueltos sin contexto.
        */}
        <table className="order-detail__items">
          {/*
            El <caption> describe la tabla para los lectores de pantalla. Se
            oculta a la vista con .visually-hidden (la clase que ya existe en
            index.css) y no con display:none, porque display:none lo sacaría
            también del árbol de accesibilidad y la tabla quedaría sin descripción.
          */}
          <caption className="visually-hidden">Productos de esta orden</caption>
          <thead>
            <tr>
              <th scope="col">Producto</th>
              <th scope="col">Precio de compra</th>
              <th scope="col">Cantidad</th>
              <th scope="col">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.productId}>
                <td>{item.name}</td>
                {/*
                  Este precio es el del MOMENTO DE LA COMPRA, guardado en la
                  orden. No se lee del catálogo: si el producto cambió de precio
                  o fue eliminado, esta pantalla tiene que seguir mostrando lo
                  que realmente se pagó.
                */}
                <td>{formatPrice(item.priceAtPurchase)}</td>
                <td>{item.quantity}</td>
                <td>{formatPrice(Math.round(item.priceAtPurchase * item.quantity * 100) / 100)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              {/*
                colSpan agrupa las tres primeras columnas para que "Total" quede
                alineado con la columna de subtotales.
              */}
              <th scope="row" colSpan={3}>
                Total
              </th>
              <td>
                <strong>{formatPrice(total)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </>
    );
  }

  return (
    <div className="page">
      <h1>Detalle de la orden</h1>

      {/*
        El id se muestra fuera del bloque de contenido para que esté visible
        también mientras carga o si algo falla: si alguien reporta un problema,
        ese es el dato que hay que pedirle.
      */}
      <p className="order-detail__id">
        Orden <strong>{orderId}</strong>
      </p>

      {renderContent()}

      <Link to="/orders" className="order-detail__back-link">
        Volver a mis órdenes
      </Link>
    </div>
  );
}

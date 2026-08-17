import { useRef, useState } from "react";
import { Link } from "react-router";
import { EmptyState } from "../components/states/EmptyState";
import { useAuth } from "../contexts/AuthContext";
import { useCart } from "../features/cart/useCart";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { formatPrice } from "../lib/formatPrice";
import { mapOrderError, type OrderError } from "../lib/orderErrors";
import { createOrderFromCart } from "../services/ordersService";

export function CheckoutPage() {
  // Un solo título para las tres pantallas de esta página (compra pendiente,
  // confirmación y carrito vacío): todas son "el checkout" para quien mira la
  // pestaña o el historial.
  useDocumentTitle("Checkout");

  const { user } = useAuth();
  const { items, totalItems, totalPrice, clearCart } = useCart();

  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<OrderError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Segundo cerrojo contra el doble envío, además del botón deshabilitado.
  //
  // Por qué no alcanza con "disabled={isSubmitting}": deshabilitar el botón
  // depende de que React vuelva a renderizar, y eso ocurre DESPUÉS de que
  // termina el manejador del evento. Dos clicks muy rápidos (o un doble click)
  // pueden dispararse ambos antes de ese re-render, y el segundo encontraría el
  // botón todavía habilitado. Un ref se actualiza en el acto, en la misma línea,
  // sin esperar a React. El estado es para lo que el usuario VE; el ref, para lo
  // que el código DECIDE.
  const isSubmittingRef = useRef(false);

  async function handleConfirmPurchase(): Promise<void> {
    if (isSubmittingRef.current) {
      return;
    }
    isSubmittingRef.current = true;

    setError(null);
    setIsSubmitting(true);

    try {
      const createdOrderId = await createOrderFromCart(user?.uid ?? "", {
        items,
        totalItems,
        totalPrice,
      });

      // Los efectos del éxito van DENTRO del try y DESPUÉS del await exitoso.
      // Si estuvieran en el finally, se ejecutarían también cuando la creación
      // falla: se vaciaría el carrito de alguien cuya compra nunca se registró.
      clearCart();
      setOrderId(createdOrderId);
    } catch (caughtError) {
      setError(mapOrderError(caughtError));
    } finally {
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }
  }

  // La confirmación se chequea ANTES que el carrito vacío. El orden importa:
  // una compra exitosa vacía el carrito, así que si se preguntara primero por el
  // carrito, el usuario vería "tu carrito está vacío" justo después de comprar,
  // en vez de la confirmación de su compra.
  if (orderId !== null) {
    return (
      <div className="page">
        <h1>¡Gracias por tu compra!</h1>
        <p className="checkout__confirmation" role="status">
          Tu orden <strong>{orderId}</strong> fue registrada correctamente.
        </p>
        <Link to="/" className="checkout__back-link">
          Volver al catálogo
        </Link>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="page">
        <h1>Checkout</h1>
        <EmptyState message="No hay nada para comprar: tu carrito está vacío." />
        <Link to="/" className="checkout__back-link">
          Ver el catálogo
        </Link>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Checkout</h1>

      <ul className="checkout__items" role="list">
        {items.map((item) => (
          <li key={item.productId} className="checkout__item">
            <span>
              {item.name} × {item.quantity}
            </span>
            <span>{formatPrice(Math.round(item.unitPrice * item.quantity * 100) / 100)}</span>
          </li>
        ))}
      </ul>

      <p className="checkout__total">
        Total ({totalItems} {totalItems === 1 ? "unidad" : "unidades"}):{" "}
        <strong>{formatPrice(totalPrice)}</strong>
      </p>

      {error && (
        // role="alert" hace que el lector de pantalla lea el mensaje apenas
        // aparece, sin esperar a que el usuario navegue hasta él. Es lo correcto
        // para un error: es información urgente que responde a una acción que la
        // persona acaba de hacer.
        <p className="checkout__error" role="alert">
          {error.message}
        </p>
      )}

      {/*
        Las dos acciones van juntas y en este orden: primero la principal
        (confirmar), después la de escape (volver al carrito). Es el orden en
        que las lee un lector de pantalla y el orden en que las recorre el
        teclado con Tab, así que la acción que la mayoría busca aparece
        primero.

        El enlace al carrito no es decorativo: si la compra falla porque cambió
        un precio, el mensaje de error dice literalmente "volvé al carrito", y
        hasta ahora no había ningún enlace que lo hiciera — el único camino era
        el menú de arriba. Un mensaje que pide una acción tiene que ofrecerla.
      */}
      <div className="checkout__actions">
        <button
          type="button"
          className="checkout__submit"
          onClick={handleConfirmPurchase}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Confirmando compra..." : "Confirmar compra"}
        </button>

        <Link to="/cart" className="checkout__back-link">
          Volver al carrito
        </Link>
      </div>
    </div>
  );
}

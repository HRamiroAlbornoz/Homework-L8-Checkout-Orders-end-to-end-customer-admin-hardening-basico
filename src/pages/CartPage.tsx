import { useState } from "react";
import { Link } from "react-router";
import { EmptyState } from "../components/states/EmptyState";
import { CartItemRow } from "../features/cart/components/CartItemRow";
import { useCart } from "../features/cart/useCart";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { formatPrice } from "../lib/formatPrice";

export function CartPage() {
  // Arriba de todo y ANTES del "return" temprano del carrito vacío: los hooks
  // tienen que ejecutarse siempre, en el mismo orden, en cada render. Si esta
  // línea estuviera después del "if (items.length === 0)", React vería un
  // número distinto de hooks según el estado del carrito y rompería.
  useDocumentTitle("Carrito");

  const { items, totalItems, totalPrice, clearCart } = useCart();

  // Estado local del pedido de confirmación para vaciar el carrito. Es una
  // interacción de esta pantalla y de nadie más, así que no tiene por qué vivir
  // en el estado global del carrito.
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);

  if (items.length === 0) {
    return (
      <div className="page">
        <h1>Carrito</h1>
        <EmptyState message="Tu carrito está vacío." />
        <Link to="/" className="cart-page__back-link">
          Ver el catálogo
        </Link>
      </div>
    );
  }

  function handleConfirmClear(): void {
    clearCart();
    setIsConfirmingClear(false);
  }

  return (
    <div className="page">
      <h1>Carrito</h1>

      {/*
        Lista real (<ul>/<li>) en vez de <div>: un lector de pantalla anuncia
        "lista de 3 elementos" y permite saltar de uno a otro. Con divs, esa
        estructura no existe.
      */}
      {/*
        role="list" es redundante en teoría (un <ul> ya es una lista), pero
        necesario en la práctica: cuando una lista lleva "list-style: none" en el
        CSS —como esta—, VoiceOver en Safari le quita las semánticas de lista y
        deja de anunciar "lista de 2 elementos". Declararlo explícitamente
        restituye ese comportamiento sin afectar a los demás navegadores.
      */}
      <ul className="cart-page__items" role="list">
        {items.map((item) => (
          <CartItemRow key={item.productId} item={item} />
        ))}
      </ul>

      <div className="cart-page__summary">
        <p className="cart-page__total">
          Total ({totalItems} {totalItems === 1 ? "unidad" : "unidades"}):{" "}
          <strong>{formatPrice(totalPrice)}</strong>
        </p>

        <Link to="/checkout" className="cart-page__checkout-link">
          Finalizar compra
        </Link>
      </div>

      {isConfirmingClear ? (
        // role="alertdialog" + aria-live: un lector de pantalla anuncia este
        // bloque apenas aparece, en vez de dejarlo pasar desapercibido.
        <div className="cart-page__confirm" role="alertdialog" aria-live="assertive">
          {/*
            La confirmación dice EXACTAMENTE qué se va a perder, con los nombres
            de los productos. Un "¿Estás seguro?" a secas obliga al usuario a
            recordar de memoria qué había en el carrito para poder decidir.
          */}
          <p>
            Se van a quitar {totalItems}{" "}
            {totalItems === 1 ? "unidad" : "unidades"}: {items.map((item) => item.name).join(", ")}.
            Esta acción no se puede deshacer.
          </p>
          <button type="button" className="cart-page__confirm-yes" onClick={handleConfirmClear}>
            Sí, vaciar el carrito
          </button>
          <button
            type="button"
            className="cart-page__confirm-no"
            onClick={() => setIsConfirmingClear(false)}
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="cart-page__clear"
          onClick={() => setIsConfirmingClear(true)}
        >
          Vaciar carrito
        </button>
      )}
    </div>
  );
}

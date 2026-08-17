import { Link } from "react-router";
import { useCart } from "../useCart";

/**
 * Contador del carrito para el header: muestra cuántas unidades hay y lleva a
 * la página del carrito.
 */
export function CartBadge() {
  const { totalItems } = useCart();

  // "1 producto" / "0 productos": el plural se arma acá y no en el JSX para que
  // la lógica quede fuera del marcado.
  const itemsLabel = totalItems === 1 ? "1 producto" : `${totalItems} productos`;

  return (
    // aria-live="polite" hace que un lector de pantalla anuncie el cambio cuando
    // el número sube, sin interrumpir lo que el usuario esté escuchando. Sin
    // esto, alguien que no ve la pantalla no tendría forma de saber que su click
    // en "Agregar al carrito" hizo algo.
    // aria-label arma el nombre accesible completo ("Carrito 3 productos"),
    // empezando por el texto visible como pide la pauta WCAG 2.5.3. Sin él, el
    // nombre se calcularía concatenando los textos de adentro SIN espacios entre
    // ellos, y quedaría "Carrito3".
    //
    // aria-live="polite" hace que un lector de pantalla anuncie el cambio cuando
    // el número sube, sin interrumpir lo que el usuario esté escuchando. Sin
    // esto, alguien que no ve la pantalla no tendría forma de saber que su click
    // en "Agregar al carrito" hizo algo.
    <Link
      to="/cart"
      className="cart-badge"
      aria-label={`Carrito ${itemsLabel}`}
      aria-live="polite"
    >
      Carrito
      {/* El número ya está dicho en el aria-label: acá es solo decoración visual. */}
      <span className="cart-badge__count" aria-hidden="true">
        {totalItems}
      </span>
    </Link>
  );
}

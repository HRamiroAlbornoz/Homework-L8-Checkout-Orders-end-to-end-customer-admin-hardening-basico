import { formatPrice } from "@/lib/formatPrice";
import type { CartItem } from "../types";
import { useCart } from "../useCart";
import { QuantitySelector } from "./QuantitySelector";

interface CartItemRowProps {
  item: CartItem;
}

/**
 * Una fila del carrito: producto, precio unitario, selector de cantidad,
 * subtotal y botón para eliminarlo.
 */
export function CartItemRow({ item }: CartItemRowProps) {
  const { updateQuantity, removeItem } = useCart();

  // Subtotal de la fila. Se redondea igual que en el reducer, porque acá también
  // se multiplican decimales: 3 unidades de $19.99 dan 59.97000000000001 sin
  // redondear.
  const lineTotal = Math.round(item.unitPrice * item.quantity * 100) / 100;

  return (
    <li className="cart-item">
      <div className="cart-item__info">
        <h2 className="cart-item__name">{item.name}</h2>
        <p className="cart-item__unit-price">{formatPrice(item.unitPrice)} por unidad</p>
      </div>

      <QuantitySelector
        productName={item.name}
        quantity={item.quantity}
        onChange={(quantity) => updateQuantity(item.productId, quantity)}
      />

      <p className="cart-item__subtotal">
        <span className="visually-hidden">Subtotal de {item.name}: </span>
        {formatPrice(lineTotal)}
      </p>

      <button
        type="button"
        className="cart-item__remove"
        // Sin el nombre del producto, un carrito con 5 filas tendría 5 botones
        // llamados "Eliminar" y sería imposible saber cuál es cuál sin ver la
        // pantalla. El texto visible va primero para cumplir WCAG 2.5.3.
        aria-label={`Eliminar ${item.name} del carrito`}
        onClick={() => removeItem(item.productId)}
      >
        Eliminar
      </button>
    </li>
  );
}

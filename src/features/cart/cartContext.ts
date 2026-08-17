import { createContext } from "react";
import type { CartItemInput, CartState } from "./types";

/**
 * Lo que el carrito le ofrece al resto de la app: el estado actual (items,
 * totalItems, totalPrice) más las acciones que se pueden ejecutar sobre él.
 *
 * Fijate que NO expone "dispatch". El provider ofrece funciones con nombre
 * (addItem, removeItem...) en vez del dispatch crudo, y la diferencia es
 * concreta: con dispatch, cada componente tendría que armar a mano el objeto
 * { type: "ADD_ITEM", payload: { item } }. Si mañana cambia la forma de esa
 * acción, habría que corregirla en cada componente que la arma. Con funciones
 * nombradas, se corrige en un solo lugar y nadie afuera se entera.
 */
export interface CartContextValue extends CartState {
  addItem: (item: CartItemInput) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
}

/**
 * El valor arranca en null a propósito, y no con un carrito vacío de mentira.
 *
 * Si el default fuera un objeto válido, un componente usado por error fuera del
 * CartProvider funcionaría "a medias": agregaría productos a un carrito fantasma
 * que nadie muestra, sin ningún error visible. Con null, el hook useCart puede
 * detectar la situación y avisar con un mensaje claro.
 *
 * Este Context no debería importarse desde los componentes: la API pública del
 * feature es el hook useCart.
 */
export const CartContext = createContext<CartContextValue | null>(null);

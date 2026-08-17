import { MAX_QUANTITY_PER_ITEM } from "./cartConstants";
import type { CartAction, CartItem, CartState } from "./types";

// Carrito vacío. Se exporta porque lo usan el provider (estado inicial), el
// storage (valor al que se vuelve si lo guardado no es válido) y los tests.
export const initialCartState: CartState = {
  items: [],
  totalItems: 0,
  totalPrice: 0,
};

/**
 * Redondea un monto a 2 decimales.
 *
 * Hace falta porque los números decimales en JavaScript son aproximaciones
 * binarias: 0.1 + 0.2 no da 0.3, da 0.30000000000000004. Sin este redondeo, un
 * carrito con dos productos baratos puede mostrar "$0.30000000000000004".
 */
function roundToCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Arma el estado completo a partir de la lista de ítems, recalculando los totales.
 *
 * TODAS las acciones que modifican la lista terminan pasando por acá. Esa es la
 * regla que garantiza la consistencia que pide el enunciado: es imposible que
 * una acción actualice los ítems y se olvide de actualizar los totales, porque
 * ninguna acción arma el estado a mano.
 *
 * Se exporta porque cartStorage.ts también la necesita: al leer un carrito
 * guardado en localStorage, los totales que vengan en el JSON no son confiables
 * (pueden haber sido editados a mano), así que se recalculan desde los ítems con
 * esta misma función. Un solo lugar calcula totales en toda la app.
 */
export function withRecalculatedTotals(items: CartItem[]): CartState {
  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = items.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0,
  );

  return { items, totalItems, totalPrice: roundToCents(totalPrice) };
}

/**
 * Reducer del carrito: recibe el estado actual y una acción, y devuelve el
 * estado nuevo. Es una función pura — no lee ni escribe nada de afuera (ni
 * localStorage, ni red, ni fecha actual), así que con los mismos argumentos
 * devuelve siempre el mismo resultado. Por eso se puede testear sin navegador,
 * sin providers y sin mocks.
 *
 * Nunca muta el estado recibido: cada caso arma arrays y objetos nuevos con
 * map/filter/spread, jamás push o asignación directa. Si mutara, React no
 * detectaría el cambio (compara por referencia) y la pantalla no se actualizaría.
 */
export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "ADD_ITEM": {
      const { item } = action.payload;
      const alreadyInCart = state.items.some(
        (cartItem) => cartItem.productId === item.productId,
      );

      // Producto nuevo: entra al final con cantidad 1.
      if (!alreadyInCart) {
        return withRecalculatedTotals([...state.items, { ...item, quantity: 1 }]);
      }

      // Producto repetido: NO se duplica la fila, se incrementa la cantidad de
      // la que ya estaba (topeada al máximo).
      const updatedItems = state.items.map((cartItem) =>
        cartItem.productId === item.productId
          ? {
              ...cartItem,
              quantity: Math.min(cartItem.quantity + 1, MAX_QUANTITY_PER_ITEM),
            }
          : cartItem,
      );

      return withRecalculatedTotals(updatedItems);
    }

    case "REMOVE_ITEM": {
      const remainingItems = state.items.filter(
        (cartItem) => cartItem.productId !== action.payload.productId,
      );

      // Si el id no estaba en el carrito, filter devuelve una lista del mismo
      // largo. Se devuelve el estado original (la misma referencia) en vez de
      // uno nuevo idéntico: así React no re-renderiza por un cambio que no pasó.
      if (remainingItems.length === state.items.length) {
        return state;
      }

      return withRecalculatedTotals(remainingItems);
    }

    case "UPDATE_QUANTITY": {
      const { productId, quantity } = action.payload;
      const itemExists = state.items.some(
        (cartItem) => cartItem.productId === productId,
      );

      if (!itemExists) {
        return state;
      }

      // Cantidad 0 o negativa significa "sacalo del carrito". Se trata acá y no
      // en la UI para que la regla valga siempre, sin importar quién dispare la
      // acción (el selector de cantidad, un botón, o código futuro).
      if (quantity <= 0) {
        return withRecalculatedTotals(
          state.items.filter((cartItem) => cartItem.productId !== productId),
        );
      }

      // Math.floor descarta decimales (una cantidad de 2.7 unidades no existe) y
      // Math.min aplica el tope máximo.
      const safeQuantity = Math.min(Math.floor(quantity), MAX_QUANTITY_PER_ITEM);

      return withRecalculatedTotals(
        state.items.map((cartItem) =>
          cartItem.productId === productId
            ? { ...cartItem, quantity: safeQuantity }
            : cartItem,
        ),
      );
    }

    case "CLEAR_CART": {
      return initialCartState;
    }

    default: {
      // Red de seguridad. Con la unión discriminada completa, TypeScript ya
      // garantiza que no hay otros valores de "type", así que esta rama es
      // inalcanzable hoy. Se deja porque devolver el estado sin tocar es la
      // única respuesta correcta si algún día llega una acción no contemplada:
      // lo peor que puede hacer un reducer es romper el carrito del usuario.
      return state;
    }
  }
}

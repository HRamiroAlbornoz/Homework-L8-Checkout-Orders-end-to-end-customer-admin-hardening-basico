import { useCallback, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { CartContext, type CartContextValue } from "./cartContext";
import { cartReducer } from "./cartReducer";
import { loadCartState, saveCartState } from "./cartStorage";
import type { CartItemInput, CartState } from "./types";

interface CartProviderProps {
  children: ReactNode;
  /**
   * Estado inicial explícito. En la app real no se pasa nunca (el carrito se
   * levanta de localStorage); existe para que los tests puedan arrancar con un
   * carrito ya cargado sin tener que simular los clicks que lo llenaron.
   */
  initialState?: CartState | undefined;
}

/**
 * Decide con qué estado arranca el carrito: el que le pasaron explícitamente
 * (tests) o el que haya guardado en localStorage (app real).
 *
 * Está afuera del componente porque no depende de nada de él: definirla adentro
 * crearía una función nueva en cada render sin ningún beneficio.
 */
function resolveInitialState(preloadedState: CartState | undefined): CartState {
  return preloadedState ?? loadCartState();
}

export function CartProvider({ children, initialState }: CartProviderProps) {
  // Tercer argumento de useReducer: el "inicializador lazy". La diferencia con
  // useReducer(cartReducer, resolveInitialState(initialState)) es importante:
  // esa forma ejecutaría la lectura de localStorage EN CADA RENDER del provider
  // (aunque React descarte el resultado después del primero). Con el
  // inicializador lazy, React la llama una sola vez, al montar.
  const [state, dispatch] = useReducer(cartReducer, initialState, resolveInitialState);

  // Persiste el carrito cada vez que cambia. Como el reducer nunca muta el
  // estado, "state" solo cambia de referencia cuando realmente pasó algo, así
  // que este efecto no corre de más.
  //
  // También corre en el primer render, y eso es deseable: si lo leído de
  // localStorage venía con totales incoherentes, loadCartState ya los corrigió,
  // y este guardado deja la versión corregida en el navegador.
  useEffect(() => {
    saveCartState(state);
  }, [state]);

  // Las cuatro acciones públicas del carrito. useCallback con dependencias
  // vacías porque "dispatch" que entrega React es estable (nunca cambia entre
  // renders), así que estas funciones se crean una sola vez en toda la vida del
  // provider. Eso es lo que permite que el useMemo de abajo sirva de algo.
  const addItem = useCallback((item: CartItemInput) => {
    dispatch({ type: "ADD_ITEM", payload: { item } });
  }, []);

  const removeItem = useCallback((productId: string) => {
    dispatch({ type: "REMOVE_ITEM", payload: { productId } });
  }, []);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    dispatch({ type: "UPDATE_QUANTITY", payload: { productId, quantity } });
  }, []);

  const clearCart = useCallback(() => {
    dispatch({ type: "CLEAR_CART" });
  }, []);

  // Memoizar el value de un Provider no es optimización prematura: es necesario.
  // Sin useMemo, este objeto sería uno nuevo en cada render del provider, y
  // React re-renderizaría TODOS los componentes que consumen el carrito (header,
  // catálogo, página del carrito) aunque el carrito no hubiera cambiado.
  const value = useMemo<CartContextValue>(
    () => ({ ...state, addItem, removeItem, updateQuantity, clearCart }),
    [state, addItem, removeItem, updateQuantity, clearCart],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

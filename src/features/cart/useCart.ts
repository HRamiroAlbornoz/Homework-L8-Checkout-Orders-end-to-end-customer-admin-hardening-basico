import { useContext } from "react";
import { CartContext, type CartContextValue } from "./cartContext";

/**
 * Única API pública del feature carrito. Los componentes usan esto, nunca el
 * CartContext directo.
 *
 * El chequeo de null no es defensivo por si acaso: es lo que convierte un error
 * imposible de diagnosticar en uno obvio. Sin él, usar useCart() fuera del
 * CartProvider devolvería null, y el error real aparecería más adelante y en
 * otro lado, como "Cannot read properties of null (reading 'items')" — un
 * mensaje que no dice nada sobre la causa (que falta un provider) ni sobre dónde
 * está el problema.
 */
export function useCart(): CartContextValue {
  const context = useContext(CartContext);

  if (context === null) {
    throw new Error("useCart debe usarse dentro de un CartProvider");
  }

  return context;
}

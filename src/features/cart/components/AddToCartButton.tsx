import { useEffect, useState } from "react";
import type { Product } from "@/types/product";
import { useCart } from "../useCart";

// Cuánto dura el mensaje de confirmación en el botón antes de volver al texto
// normal. Suficiente para que se vea, corto para no confundir al usuario sobre
// si el botón sigue disponible.
const ADDED_FEEDBACK_MS = 2000;

interface AddToCartButtonProps {
  product: Product;
}

export function AddToCartButton({ product }: AddToCartButtonProps) {
  const { addItem } = useCart();

  // Este estado NO va al carrito global: es una reacción visual momentánea de
  // este botón puntual. Subirlo al Context haría que agregar un producto
  // re-renderice toda la app para mostrar un "¡Agregado!" que solo le importa a
  // un botón.
  const [justAdded, setJustAdded] = useState(false);

  useEffect(() => {
    if (!justAdded) {
      return;
    }

    const timerId = window.setTimeout(() => setJustAdded(false), ADDED_FEEDBACK_MS);

    // Limpieza obligatoria: si el usuario navega a otra página antes de que se
    // cumpla el tiempo, el componente se desmonta pero el temporizador seguiría
    // vivo e intentaría actualizar el estado de algo que ya no existe.
    return () => window.clearTimeout(timerId);
  }, [justAdded]);

  // Un producto sin precio no puede entrar al carrito: no habría con qué
  // calcular el total. Se resuelve acá, en la puerta de entrada, y por eso el
  // resto del carrito puede asumir que todo ítem tiene precio.
  const { price } = product;
  if (price === undefined) {
    return (
      <p className="add-to-cart__unavailable">Precio no disponible</p>
    );
  }

  // El "if" de arriba ya garantiza que price es un number, pero TypeScript
  // descarta ese estrechamiento dentro de handleAddToCart: esa función se
  // ejecuta más tarde (cuando el usuario hace click) y el compilador no puede
  // asegurar que la variable siga valiendo lo mismo en ese momento futuro.
  // Copiar el valor a una constante con tipo explícito lo resuelve sin recurrir
  // a un "as", que sería apagar el chequeo en vez de satisfacerlo.
  const unitPrice: number = price;

  function handleAddToCart(): void {
    addItem({ productId: product.id, name: product.name, unitPrice });
    setJustAdded(true);
  }

  const visibleLabel = justAdded ? "¡Agregado!" : "Agregar al carrito";

  return (
    // El aria-label agrega el nombre del producto al nombre accesible del botón.
    // Sin esto, una grilla de 20 productos tendría 20 botones llamados
    // exactamente "Agregar al carrito", y alguien navegando con lector de
    // pantalla no podría distinguir cuál es cuál.
    //
    // El aria-label ARRANCA con el texto visible del botón a propósito: la pauta
    // WCAG 2.5.3 pide que el nombre accesible contenga el texto que se ve. Quien
    // usa control por voz dice "hacé click en Agregar al carrito", y el
    // navegador busca esa frase dentro del nombre accesible; si el nombre fuera
    // "Agregar Nike Air Max 90 al carrito", el comando no encontraría nada.
    //
    // Se recalcula junto con el texto visible, así el cambio a "¡Agregado!"
    // también se anuncia.
    <button
      type="button"
      className="add-to-cart"
      onClick={handleAddToCart}
      aria-label={`${visibleLabel} ${product.name}`}
    >
      {visibleLabel}
    </button>
  );
}

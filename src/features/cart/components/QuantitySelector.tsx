import { MAX_QUANTITY_PER_ITEM } from "../cartConstants";

interface QuantitySelectorProps {
  /** Nombre del producto: se usa para armar etiquetas distinguibles entre filas. */
  productName: string;
  quantity: number;
  onChange: (quantity: number) => void;
}

/**
 * Selector de cantidad de una fila del carrito: dos botones y un número.
 *
 * No usa un <input type="number"> a propósito. Ese control deja escribir
 * cualquier cosa (letras, notación científica, valores negativos) y obliga a
 * validar texto libre en cada tecla. Con botones, las únicas transiciones
 * posibles son +1 y -1, que es exactamente lo que el carrito permite.
 */
export function QuantitySelector({ productName, quantity, onChange }: QuantitySelectorProps) {
  return (
    <div className="quantity-selector">
      <button
        type="button"
        className="quantity-selector__button"
        // Cada botón necesita un nombre accesible propio: en un carrito con
        // varias filas habría muchos botones "−" indistinguibles entre sí.
        aria-label={`Quitar una unidad de ${productName}`}
        onClick={() => onChange(quantity - 1)}
      >
        −
      </button>

      {/*
        aria-live="polite" hace que el lector de pantalla anuncie la cantidad
        nueva después de tocar un botón. El foco se queda en el botón, así que
        sin esto el cambio sería invisible para quien no ve la pantalla.
      */}
      <span className="quantity-selector__value" aria-live="polite">
        <span className="visually-hidden">Cantidad de {productName}: </span>
        {quantity}
      </span>

      <button
        type="button"
        className="quantity-selector__button"
        aria-label={`Agregar una unidad de ${productName}`}
        // Al llegar al tope se deshabilita, en vez de dejar clickear sin efecto:
        // un botón que no hace nada al tocarlo se siente como una app rota.
        disabled={quantity >= MAX_QUANTITY_PER_ITEM}
        onClick={() => onChange(quantity + 1)}
      >
        +
      </button>
    </div>
  );
}

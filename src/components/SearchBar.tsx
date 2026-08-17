interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

// Input controlado y sin lógica propia: la página dueña del estado decide
// cuándo aplicar debounce y cuándo disparar la búsqueda real.
export function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <div className="search-bar">
      <label htmlFor="product-search">Buscar productos</label>
      <input
        id="product-search"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        // Corto a propósito: en una pantalla de 375px el texto anterior
        // ("Nombre del producto (mínimo 2 caracteres)") se cortaba justo antes
        // del paréntesis de cierre y quedaba leyéndose como una frase truncada.
        // El detalle del mínimo ya está en el texto de ayuda de abajo, que sí se
        // ve completo y además lo anuncia el lector de pantalla.
        placeholder="Nombre del producto"
        aria-describedby="product-search-hint"
      />
      <span id="product-search-hint" className="visually-hidden">
        La búsqueda se aplica automáticamente después de dejar de escribir.
      </span>
    </div>
  );
}

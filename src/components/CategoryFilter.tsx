import { CATEGORIES } from "../constants/categories";

interface CategoryFilterProps {
  value: string | null;
  onChange: (categoryId: string | null) => void;
}

// null representa "todas las categorías" (sin filtro); el <select> nativo ya
// trae accesibilidad de teclado y lector de pantalla sin esfuerzo extra.
export function CategoryFilter({ value, onChange }: CategoryFilterProps) {
  return (
    <div className="category-filter">
      <label htmlFor="category-select">Categoría</label>
      <select
        id="category-select"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
      >
        <option value="">Todas las categorías</option>
        {CATEGORIES.map((category) => (
          <option key={category.id} value={category.id}>
            {category.label}
          </option>
        ))}
      </select>
    </div>
  );
}

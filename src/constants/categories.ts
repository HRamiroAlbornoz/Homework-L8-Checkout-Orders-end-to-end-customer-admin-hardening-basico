// Única fuente de verdad de las categorías del catálogo: la usan tanto
// CategoryFilter (para poblar el select) como scripts/seed.ts (para generar
// productos de cada categoría), así nunca quedan desincronizadas.
export const CATEGORIES = [
  { id: "calzado", label: "Calzado" },
  { id: "ropa", label: "Ropa" },
  { id: "accesorios", label: "Accesorios" },
  { id: "electronica", label: "Electrónica" },
  { id: "hogar", label: "Hogar" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

// Resuelve el label legible de una categoría a partir de su id. Si el id no
// matchea ninguna categoría conocida (dato inconsistente en Firestore), se
// devuelve el id crudo en vez de romper la UI.
export function getCategoryLabel(categoryId: string): string {
  return CATEGORIES.find((category) => category.id === categoryId)?.label ?? categoryId;
}

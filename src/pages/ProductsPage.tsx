import { useEffect, useState } from "react";
import { useProducts } from "../contexts/ProductsContext";
import { useDebounce } from "../hooks/useDebounce";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { SearchBar } from "../components/SearchBar";
import { CategoryFilter } from "../components/CategoryFilter";
import { ProductGrid } from "../components/ProductGrid";
import { LoadMoreButton } from "../components/LoadMoreButton";
import { LoadingState } from "../components/states/LoadingState";
import { EmptyState } from "../components/states/EmptyState";
import { ErrorState } from "../components/states/ErrorState";
import { getCategoryLabel } from "../constants/categories";
import { MIN_SEARCH_CHARS } from "../constants/search";
import type { ProductQueryParams } from "../types/product";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 400;

// Arma los params de consulta sin nunca asignar explícitamente "undefined" a
// una propiedad opcional: con exactOptionalPropertyTypes activo, eso es un
// error de tipos distinto de directamente omitir la propiedad.
function buildQueryParams(categoryId: string | null, searchPrefix: string | undefined): Omit<ProductQueryParams, "cursor"> {
  return {
    pageSize: PAGE_SIZE,
    ...(categoryId ? { categoryId } : {}),
    ...(searchPrefix ? { searchPrefix } : {}),
  };
}

function buildEmptyMessage(searchPrefix: string | undefined, categoryId: string | null): string {
  const categoryLabel = categoryId ? getCategoryLabel(categoryId) : null;

  if (searchPrefix && categoryLabel) {
    return `No hay resultados para "${searchPrefix}" en la categoría ${categoryLabel}.`;
  }
  if (searchPrefix) {
    return `No hay resultados para "${searchPrefix}".`;
  }
  if (categoryLabel) {
    return `No hay productos en la categoría ${categoryLabel}.`;
  }
  return "Todavía no hay productos.";
}

export function ProductsPage() {
  useDocumentTitle("Catálogo");

  const [searchInput, setSearchInput] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const debouncedSearch = useDebounce(searchInput, DEBOUNCE_MS);

  const { products, loading, loadingMore, error, hasMore, loadFirstPage, loadMore } = useProducts();

  const normalizedSearch = debouncedSearch.trim().toLowerCase();
  const searchPrefix = normalizedSearch.length >= MIN_SEARCH_CHARS ? normalizedSearch : undefined;

  useEffect(() => {
    loadFirstPage(buildQueryParams(categoryId, searchPrefix));
    // loadFirstPage no se incluye a propósito: se recrea en cada render (no
    // está memoizada) y agregarla como dependencia dispararía un loop infinito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, searchPrefix]);

  return (
    // <div> y no <main>: RootLayout ya envuelve todas las rutas en un <main>,
    // y anidar uno dentro de otro deja la página con DOS landmarks de contenido
    // principal. Un lector de pantalla los ofrece como dos destinos distintos y
    // quien navega por landmarks no sabe cuál es el bueno. Debe haber
    // exactamente uno por página.
    <div className="products-page">
      <h1>Catálogo de productos</h1>

      <div className="products-page__filters">
        <SearchBar value={searchInput} onChange={setSearchInput} />
        <CategoryFilter value={categoryId} onChange={setCategoryId} />
      </div>

      <div aria-live="polite">
        {loading && <LoadingState />}
        {!loading && error && (
          <ErrorState message={error} onRetry={() => loadFirstPage(buildQueryParams(categoryId, searchPrefix))} />
        )}
        {!loading && !error && products.length === 0 && (
          <EmptyState message={buildEmptyMessage(searchPrefix, categoryId)} />
        )}
      </div>

      {!loading && !error && products.length > 0 && (
        <>
          <ProductGrid products={products} />
          <LoadMoreButton hasMore={hasMore} loading={loadingMore} onClick={loadMore} />
        </>
      )}
    </div>
  );
}

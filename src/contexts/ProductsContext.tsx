import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import type { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";
import { listProducts } from "../services/productsService";
import type { Product, ProductQueryParams } from "../types/product";

interface ProductsState {
  products: Product[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

// Los params para pedir la primera página nunca incluyen "cursor": ese lo
// arma internamente loadMore a partir del lastDoc guardado en el estado.
type LoadFirstPageParams = Omit<ProductQueryParams, "cursor">;

interface ProductsContextValue extends ProductsState {
  loadFirstPage: (params: LoadFirstPageParams) => Promise<void>;
  loadMore: () => Promise<void>;
  reset: () => void;
}

const initialState: ProductsState = {
  products: [],
  // Arranca en true: ProductsPage siempre dispara loadFirstPage al montar, así
  // que el primer render muestra el spinner en vez de un flash de "sin productos"
  // antes de que la carga inicial termine.
  loading: true,
  loadingMore: false,
  error: null,
  lastDoc: null,
  hasMore: true,
};

const ProductsContext = createContext<ProductsContextValue | null>(null);

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Error desconocido al cargar los productos";
}

// Combina productos ya cargados con los nuevos, sin repetir ningún "id".
// Un Map indexado por id se queda automáticamente con una sola copia por id.
function mergeUniqueById(existing: Product[], incoming: Product[]): Product[] {
  const byId = new Map<string, Product>();
  for (const product of existing) byId.set(product.id, product);
  for (const product of incoming) byId.set(product.id, product);
  return Array.from(byId.values());
}

export function ProductsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProductsState>(initialState);
  // Guarda los params vigentes (filtros/búsqueda) para que loadMore los reutilice
  // sin que la página tenga que volver a pasarlos.
  const currentParamsRef = useRef<LoadFirstPageParams | null>(null);
  // "Generación" de la carga vigente: cada loadFirstPage la incrementa. Si una
  // respuesta async resuelve cuando ya cambió (el usuario cambió de filtro antes
  // de que terminara), se descarta en vez de pisar el estado con datos viejos.
  const requestIdRef = useRef(0);
  // Lock síncrono para loadMore: a diferencia de state.loadingMore (que solo se
  // actualiza en el próximo render), este ref se lee/escribe al instante, así
  // que un doble click en la misma tarea de JS no pasa el guard dos veces.
  const loadingMoreRef = useRef(false);

  async function loadFirstPage(params: LoadFirstPageParams): Promise<void> {
    const requestId = ++requestIdRef.current;
    currentParamsRef.current = params;
    setState((prev) => ({
      ...prev,
      loading: true,
      error: null,
      products: [],
      lastDoc: null,
      hasMore: true,
    }));

    try {
      const { items, lastDoc } = await listProducts(params);
      if (requestId !== requestIdRef.current) return; // el usuario ya cambió de filtro
      setState((prev) => ({
        ...prev,
        loading: false,
        products: items,
        lastDoc,
        hasMore: items.length === params.pageSize,
      }));
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setState((prev) => ({ ...prev, loading: false, error: toErrorMessage(error) }));
    }
  }

  async function loadMore(): Promise<void> {
    const params = currentParamsRef.current;
    const lastDoc = state.lastDoc;
    const requestId = requestIdRef.current;

    // Guard clause: nada que hacer si ya está cargando más, si no hay más
    // páginas, o si todavía no se cargó una primera página exitosamente.
    if (loadingMoreRef.current || !state.hasMore || !lastDoc || !params) return;

    loadingMoreRef.current = true;
    setState((prev) => ({ ...prev, loadingMore: true }));

    try {
      const { items, lastDoc: newLastDoc } = await listProducts({ ...params, cursor: lastDoc });
      // Si mientras tanto se disparó un loadFirstPage (cambio de filtro), esta
      // página ya no corresponde a nada visible: se descarta sin tocar el estado.
      if (requestId !== requestIdRef.current) return;
      setState((prev) => ({
        ...prev,
        loadingMore: false,
        products: mergeUniqueById(prev.products, items),
        lastDoc: newLastDoc,
        hasMore: items.length === params.pageSize,
      }));
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setState((prev) => ({ ...prev, loadingMore: false, error: toErrorMessage(error) }));
    } finally {
      loadingMoreRef.current = false;
    }
  }

  function reset(): void {
    currentParamsRef.current = null;
    requestIdRef.current += 1;
    setState(initialState);
  }

  const value: ProductsContextValue = { ...state, loadFirstPage, loadMore, reset };

  return <ProductsContext.Provider value={value}>{children}</ProductsContext.Provider>;
}

// Decisión a propósito: useProducts vive junto a su ProductsProvider por
// simplicidad (proyecto chico, un solo dominio). Esto solo afecta Fast Refresh
// en desarrollo (recarga el archivo completo en vez de solo el componente al
// editar), sin impacto en la app en producción.
// eslint-disable-next-line react-refresh/only-export-components
export function useProducts(): ProductsContextValue {
  const context = useContext(ProductsContext);
  if (!context) {
    throw new Error("useProducts debe usarse dentro de un ProductsProvider");
  }
  return context;
}

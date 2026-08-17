import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { CartProvider } from "@/features/cart/CartProvider";
import type { CartState } from "@/features/cart/types";

export interface ProvidersOptions {
  /** Carrito ya cargado, para no tener que simular los clicks que lo llenaron. */
  preloadedCartState?: CartState | undefined;
  /** Ruta(s) iniciales del router. Por defecto, la home. */
  initialEntries?: string[];
}

/**
 * Arma el componente que envuelve a lo que se está testeando con los providers
 * que necesita.
 *
 * Qué incluye y por qué:
 *
 * - MemoryRouter: casi todo componente del proyecto usa <Link> o useNavigate, y
 *   sin un router alrededor React Router lanza un error. "Memory" significa que
 *   la navegación vive en memoria en vez de en la barra de direcciones, que es
 *   lo que corresponde en un test.
 *
 * - CartProvider: es el provider del feature nuevo y es seguro de montar (no
 *   toca la red).
 *
 * Qué NO incluye, a propósito:
 *
 * - AuthProvider: al montarse se suscribe a onAuthStateChanged, que es una
 *   conexión real a Firebase Auth. Incluirlo obligaría a TODOS los tests que
 *   usen este wrapper a mockear el SDK de Firebase, aunque no tengan nada que
 *   ver con la sesión.
 *
 * - ProductsProvider: importarlo arrastra productsService → lib/firebase →
 *   lib/env, y ese último valida las variables de entorno EN EL MOMENTO DE
 *   IMPORTAR el módulo. Es decir: bastaría con importar el wrapper para que un
 *   entorno sin variables (por ejemplo, el CI) rompiera antes de correr un test.
 *
 * Los pocos tests que necesitan sesión usan vi.mock sobre useAuth, que es el
 * patrón que este repo ya tiene establecido y funcionando. Un wrapper que
 * obligue a mockear medio SDK deja de simplificar y pasa a complicar.
 */
export function createProvidersWrapper({
  preloadedCartState,
  initialEntries = ["/"],
}: ProvidersOptions = {}) {
  return function Providers({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <CartProvider initialState={preloadedCartState}>{children}</CartProvider>
      </MemoryRouter>
    );
  };
}

/**
 * Renderiza un componente ya envuelto en los providers.
 *
 * Devuelve exactamente lo mismo que el render de Testing Library, así que se
 * puede usar screen, rerender, unmount, etc. como siempre.
 *
 * Para testear un hook en vez de un componente se usa renderHook de Testing
 * Library pasándole createProvidersWrapper() como opción "wrapper" — las dos
 * vías comparten la misma composición de providers, así que no pueden quedar
 * desincronizadas.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: ProvidersOptions = {},
  renderOptions?: Omit<RenderOptions, "wrapper">,
): RenderResult {
  return render(ui, { wrapper: createProvidersWrapper(options), ...renderOptions });
}

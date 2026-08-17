import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigationType } from "react-router";
import { ProtectedRoute } from "./ProtectedRoute";
import { useAuth } from "../contexts/AuthContext";
import type { UserProfile } from "../types/user";

// No montamos AuthProvider real: mockeamos useAuth directamente para poder
// simular cada combinación de loading/user sin depender de Firebase.
vi.mock("../contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

type AuthState = ReturnType<typeof useAuth>;

// Arma el valor devuelto por useAuth con defaults razonables, para no repetir
// los 6 campos en cada test. Devuelve el objeto completo (incluidos los mocks
// de signup/login/logout) para poder asserar sobre ellos cuando haga falta.
function mockAuth(overrides: Partial<AuthState>): AuthState {
  const value: AuthState = {
    user: null,
    loading: false,
    error: null,
    signup: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  };
  vi.mocked(useAuth).mockReturnValue(value);
  return value;
}

// Muestra el tipo de navegación ("PUSH" | "REPLACE" | "POP") con el que se
// llegó a esta página: permite verificar que ProtectedRoute usa "replace" de
// verdad, no solo que redirige a la URL correcta.
function LoginPageWithNavType() {
  const navType = useNavigationType();
  return <p>Página de login (nav: {navType})</p>;
}

function renderProtectedRoute(initialPath = "/cart") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/cart" element={<p>Contenido del carrito</p>} />
          <Route path="/checkout" element={<p>Contenido del checkout</p>} />
        </Route>
        <Route path="/login" element={<LoginPageWithNavType />} />
      </Routes>
    </MemoryRouter>
  );
}

const sampleCustomer: UserProfile = {
  uid: "uid-1",
  email: "hernan@example.com",
  displayName: "Hernán",
  role: "customer",
  createdAt: {} as UserProfile["createdAt"],
};

const sampleAdmin: UserProfile = { ...sampleCustomer, uid: "uid-admin", role: "admin" };

describe("ProtectedRoute", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReset();
  });

  it("mientras loading es true, muestra el spinner y no redirige ni muestra el contenido", () => {
    mockAuth({ user: null, loading: true });

    renderProtectedRoute();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("Contenido del carrito")).not.toBeInTheDocument();
    expect(screen.queryByText(/Página de login/)).not.toBeInTheDocument();
  });

  it("con loading terminado y sin usuario, redirige a /login", () => {
    mockAuth({ user: null, loading: false });

    renderProtectedRoute();

    expect(screen.getByText(/Página de login/)).toBeInTheDocument();
    expect(screen.queryByText("Contenido del carrito")).not.toBeInTheDocument();
  });

  it("con un usuario customer logueado, muestra el contenido protegido", () => {
    mockAuth({ user: sampleCustomer, loading: false });

    renderProtectedRoute();

    expect(screen.getByText("Contenido del carrito")).toBeInTheDocument();
  });

  it("con un usuario admin logueado, también muestra el contenido protegido (no es exclusivo de customer)", () => {
    mockAuth({ user: sampleAdmin, loading: false });

    renderProtectedRoute();

    expect(screen.getByText("Contenido del carrito")).toBeInTheDocument();
  });

  it("loading tiene prioridad sobre el error: si hay error pero todavía está cargando, muestra el spinner", () => {
    mockAuth({ user: null, loading: true, error: "algo falló antes" });

    renderProtectedRoute();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(/Página de login/)).not.toBeInTheDocument();
  });

  it("loading tiene prioridad sobre user: si loading es true, muestra el spinner aunque 'user' ya tenga un valor", () => {
    // Estado inconsistente a propósito (no ocurre con el AuthContext real,
    // que nunca los setea juntos), pero sirve para probar que ProtectedRoute
    // respeta el ORDEN de chequeos (loading primero) y no confía en "user"
    // mientras la sesión sigue resolviendo.
    mockAuth({ user: sampleCustomer, loading: true });

    renderProtectedRoute();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("Contenido del carrito")).not.toBeInTheDocument();
  });

  it("usa 'replace' (no 'push') al redirigir a /login, para no dejar la ruta protegida en el historial", () => {
    mockAuth({ user: null, loading: false });

    renderProtectedRoute();

    expect(screen.getByText(/nav: REPLACE/)).toBeInTheDocument();
  });

  it("con sesión válida, no queda ningún spinner de carga colgado en el DOM", () => {
    mockAuth({ user: sampleCustomer, loading: false });

    renderProtectedRoute();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("protege también /checkout con el mismo guard: usuario logueado accede", () => {
    mockAuth({ user: sampleCustomer, loading: false });

    renderProtectedRoute("/checkout");

    expect(screen.getByText("Contenido del checkout")).toBeInTheDocument();
  });

  it("protege también /checkout con el mismo guard: usuario no logueado redirige a /login", () => {
    mockAuth({ user: null, loading: false });

    renderProtectedRoute("/checkout");

    expect(screen.getByText(/Página de login/)).toBeInTheDocument();
    expect(screen.queryByText("Contenido del checkout")).not.toBeInTheDocument();
  });

  it("llama a useAuth para leer el estado de sesión", () => {
    mockAuth({ user: sampleCustomer, loading: false });

    renderProtectedRoute();

    expect(useAuth).toHaveBeenCalled();
  });

  it("nunca llama a login/signup/logout por su cuenta: es solo un guard de lectura", () => {
    const auth = mockAuth({ user: sampleCustomer, loading: false });

    renderProtectedRoute();

    expect(auth.login).not.toHaveBeenCalled();
    expect(auth.signup).not.toHaveBeenCalled();
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it("el mensaje del spinner es 'Verificando sesión...'", () => {
    mockAuth({ user: null, loading: true });

    renderProtectedRoute();

    expect(screen.getByText("Verificando sesión...")).toBeInTheDocument();
  });

  it("con un usuario sin displayName (null), igual permite el acceso (no rompe con ese caso borde)", () => {
    mockAuth({ user: { ...sampleCustomer, displayName: null }, loading: false });

    renderProtectedRoute();

    expect(screen.getByText("Contenido del carrito")).toBeInTheDocument();
  });

  it("transición loading → logueado: pasa de spinner a contenido sin remontar el árbol", () => {
    mockAuth({ user: null, loading: true });
    const { rerender } = renderProtectedRoute();
    expect(screen.getByRole("status")).toBeInTheDocument();

    mockAuth({ user: sampleCustomer, loading: false });
    rerender(
      <MemoryRouter initialEntries={["/cart"]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/cart" element={<p>Contenido del carrito</p>} />
          </Route>
          <Route path="/login" element={<LoginPageWithNavType />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("Contenido del carrito")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("transición loading → sin sesión: pasa de spinner a la redirección a /login", () => {
    mockAuth({ user: null, loading: true });
    const { rerender } = renderProtectedRoute();
    expect(screen.getByRole("status")).toBeInTheDocument();

    mockAuth({ user: null, loading: false });
    rerender(
      <MemoryRouter initialEntries={["/cart"]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/cart" element={<p>Contenido del carrito</p>} />
          </Route>
          <Route path="/login" element={<LoginPageWithNavType />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/Página de login/)).toBeInTheDocument();
  });

  it("sin sesión, nunca redirige por error a la home ('/'): siempre va a /login", () => {
    mockAuth({ user: null, loading: false });

    renderProtectedRoute();

    expect(screen.queryByText("Home")).not.toBeInTheDocument();
    expect(screen.getByText(/Página de login/)).toBeInTheDocument();
  });

  it("un error previo no cambia el resultado: sin sesión y con error, igual redirige a /login", () => {
    mockAuth({ user: null, loading: false, error: "sesión inválida" });

    renderProtectedRoute();

    expect(screen.getByText(/Página de login/)).toBeInTheDocument();
  });

  it("respeta query params en la URL protegida: con sesión, accede igual a /cart?ref=email", () => {
    mockAuth({ user: sampleCustomer, loading: false });

    renderProtectedRoute("/cart?ref=email");

    expect(screen.getByText("Contenido del carrito")).toBeInTheDocument();
  });

  it("respeta query params en la URL protegida: sin sesión, redirige igual desde /cart?ref=email", () => {
    mockAuth({ user: null, loading: false });

    renderProtectedRoute("/cart?ref=email");

    expect(screen.getByText(/Página de login/)).toBeInTheDocument();
  });

  it("mientras carga, el spinner aparece una sola vez (no hay UI de loading duplicada)", () => {
    mockAuth({ user: null, loading: true });

    renderProtectedRoute();

    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});

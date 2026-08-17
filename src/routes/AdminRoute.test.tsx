import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigationType } from "react-router";
import { AdminRoute } from "./AdminRoute";
import { useAuth } from "../contexts/AuthContext";
import type { UserProfile } from "../types/user";

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
// llegó a esta página: permite verificar que AdminRoute usa "replace" de
// verdad en AMBAS redirecciones (a /login y a /), no solo que llega a la
// URL correcta.
function LoginPageWithNavType() {
  const navType = useNavigationType();
  return <p>Página de login (nav: {navType})</p>;
}

function HomeWithNavType() {
  const navType = useNavigationType();
  return <p>Home (nav: {navType})</p>;
}

function renderAdminRoute(initialPath = "/admin") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<AdminRoute />}>
          <Route path="/admin" element={<h1>Panel de administración</h1>} />
        </Route>
        <Route path="/login" element={<LoginPageWithNavType />} />
        <Route path="/" element={<HomeWithNavType />} />
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

describe("AdminRoute", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReset();
  });

  it("mientras loading es true, muestra el spinner y no redirige ni muestra el panel", () => {
    mockAuth({ user: null, loading: true });

    renderAdminRoute();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("Panel de administración")).not.toBeInTheDocument();
  });

  it("escenario 1: usuario no logueado → redirige a /login", () => {
    mockAuth({ user: null, loading: false });

    renderAdminRoute();

    expect(screen.getByText(/Página de login/)).toBeInTheDocument();
    expect(screen.queryByText("Panel de administración")).not.toBeInTheDocument();
  });

  it("escenario 2: usuario logueado con role 'customer' → redirige a / (no a /login)", () => {
    mockAuth({ user: sampleCustomer, loading: false });

    renderAdminRoute();

    expect(screen.getByText(/Home/)).toBeInTheDocument();
    expect(screen.queryByText(/Página de login/)).not.toBeInTheDocument();
    expect(screen.queryByText("Panel de administración")).not.toBeInTheDocument();
  });

  it("escenario 3: usuario logueado con role 'admin' → accede correctamente al panel", () => {
    mockAuth({ user: sampleAdmin, loading: false });

    renderAdminRoute();

    expect(screen.getByText("Panel de administración")).toBeInTheDocument();
  });

  it("loading tiene prioridad sobre el error: si hay error pero todavía está cargando, muestra el spinner", () => {
    mockAuth({ user: null, loading: true, error: "algo falló antes" });

    renderAdminRoute();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(/Página de login/)).not.toBeInTheDocument();
  });

  it("loading tiene prioridad sobre user: si loading es true, muestra el spinner aunque 'user' ya sea admin", () => {
    // Estado inconsistente a propósito (no ocurre con el AuthContext real),
    // pero prueba que AdminRoute respeta el ORDEN de chequeos: loading
    // primero, ni siquiera mira el role mientras la sesión sigue resolviendo.
    mockAuth({ user: sampleAdmin, loading: true });

    renderAdminRoute();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("Panel de administración")).not.toBeInTheDocument();
  });

  it("la redirección a /login (sin sesión) usa 'replace', no 'push'", () => {
    mockAuth({ user: null, loading: false });

    renderAdminRoute();

    expect(screen.getByText(/nav: REPLACE/)).toBeInTheDocument();
  });

  it("la redirección a / (sesión sin rol admin) también usa 'replace', no 'push'", () => {
    mockAuth({ user: sampleCustomer, loading: false });

    renderAdminRoute();

    expect(screen.getByText(/nav: REPLACE/)).toBeInTheDocument();
  });

  it("con acceso admin concedido, no queda ningún spinner de carga colgado en el DOM", () => {
    mockAuth({ user: sampleAdmin, loading: false });

    renderAdminRoute();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("llama a useAuth para leer el estado de sesión y el rol", () => {
    mockAuth({ user: sampleAdmin, loading: false });

    renderAdminRoute();

    expect(useAuth).toHaveBeenCalled();
  });

  it("nunca llama a login/signup/logout por su cuenta: es solo un guard de lectura", () => {
    const auth = mockAuth({ user: sampleAdmin, loading: false });

    renderAdminRoute();

    expect(auth.login).not.toHaveBeenCalled();
    expect(auth.signup).not.toHaveBeenCalled();
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it("el mensaje del spinner es 'Verificando sesión...'", () => {
    mockAuth({ user: null, loading: true });

    renderAdminRoute();

    expect(screen.getByText("Verificando sesión...")).toBeInTheDocument();
  });

  it("con un admin sin displayName (null), igual permite el acceso (no rompe con ese caso borde)", () => {
    mockAuth({ user: { ...sampleAdmin, displayName: null }, loading: false });

    renderAdminRoute();

    expect(screen.getByText("Panel de administración")).toBeInTheDocument();
  });

  it("transición loading → admin: pasa de spinner al panel sin remontar el árbol", () => {
    mockAuth({ user: null, loading: true });
    const { rerender } = renderAdminRoute();
    expect(screen.getByRole("status")).toBeInTheDocument();

    mockAuth({ user: sampleAdmin, loading: false });
    rerender(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<h1>Panel de administración</h1>} />
          </Route>
          <Route path="/login" element={<LoginPageWithNavType />} />
          <Route path="/" element={<HomeWithNavType />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("Panel de administración")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("transición loading → customer: pasa de spinner a la redirección a /", () => {
    mockAuth({ user: null, loading: true });
    const { rerender } = renderAdminRoute();
    expect(screen.getByRole("status")).toBeInTheDocument();

    mockAuth({ user: sampleCustomer, loading: false });
    rerender(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<h1>Panel de administración</h1>} />
          </Route>
          <Route path="/login" element={<LoginPageWithNavType />} />
          <Route path="/" element={<HomeWithNavType />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/Home/)).toBeInTheDocument();
  });

  it("transición loading → sin sesión: pasa de spinner a la redirección a /login", () => {
    mockAuth({ user: null, loading: true });
    const { rerender } = renderAdminRoute();
    expect(screen.getByRole("status")).toBeInTheDocument();

    mockAuth({ user: null, loading: false });
    rerender(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<h1>Panel de administración</h1>} />
          </Route>
          <Route path="/login" element={<LoginPageWithNavType />} />
          <Route path="/" element={<HomeWithNavType />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/Página de login/)).toBeInTheDocument();
  });

  it("un error previo no cambia el resultado: customer con error igual redirige a / (no al panel)", () => {
    mockAuth({ user: sampleCustomer, loading: false, error: "algo raro pasó" });

    renderAdminRoute();

    expect(screen.getByText(/Home/)).toBeInTheDocument();
    expect(screen.queryByText("Panel de administración")).not.toBeInTheDocument();
  });

  it("un error previo no cambia el resultado: sin sesión y con error, igual redirige a /login", () => {
    mockAuth({ user: null, loading: false, error: "sesión inválida" });

    renderAdminRoute();

    expect(screen.getByText(/Página de login/)).toBeInTheDocument();
  });

  it("respeta query params en la URL: admin accede igual a /admin?tab=productos", () => {
    mockAuth({ user: sampleAdmin, loading: false });

    renderAdminRoute("/admin?tab=productos");

    expect(screen.getByText("Panel de administración")).toBeInTheDocument();
  });

  it("un usuario customer nunca ve, ni siquiera transitoriamente, el contenido del panel", () => {
    mockAuth({ user: sampleCustomer, loading: false });

    renderAdminRoute();

    expect(screen.queryByText("Panel de administración")).not.toBeInTheDocument();
  });

  it("sin sesión, nunca redirige directamente a / : la falta de sesión siempre va a /login primero", () => {
    mockAuth({ user: null, loading: false });

    renderAdminRoute();

    expect(screen.queryByText(/^Home/)).not.toBeInTheDocument();
    expect(screen.getByText(/Página de login/)).toBeInTheDocument();
  });
});

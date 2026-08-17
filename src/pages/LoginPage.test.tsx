import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { LoginPage } from "./LoginPage";
import { useAuth } from "../contexts/AuthContext";
import type { UserProfile } from "../types/user";

// react-router NO se mockea acá: la navegación es real dentro del
// MemoryRouter, así que podemos probar el flujo completo página + formulario
// (llenar, enviar, terminar en "/") como una integración real.
vi.mock("../contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

type AuthState = ReturnType<typeof useAuth>;

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

function renderLoginPage() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<p>Home</p>} />
        <Route path="/signup" element={<p>Página de registro</p>} />
      </Routes>
    </MemoryRouter>
  );
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "hernan@example.com");
  await user.type(screen.getByLabelText("Contraseña"), "clave123");
  await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
}

const sampleCustomer: UserProfile = {
  uid: "uid-1",
  email: "hernan@example.com",
  displayName: "Hernán",
  role: "customer",
  createdAt: {} as UserProfile["createdAt"],
};

describe("LoginPage", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReset();
  });

  it("mientras loading es true, muestra el spinner y no el formulario", () => {
    mockAuth({ loading: true });

    renderLoginPage();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Iniciar sesión" })).not.toBeInTheDocument();
  });

  it("sin sesión, muestra el título y el formulario de login", () => {
    mockAuth({ user: null, loading: false });

    renderLoginPage();

    expect(screen.getByRole("heading", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeInTheDocument();
  });

  it("con sesión ya iniciada, redirige a / en vez de mostrar el formulario", () => {
    mockAuth({ user: sampleCustomer, loading: false });

    renderLoginPage();

    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Iniciar sesión" })).not.toBeInTheDocument();
  });

  it("muestra un link para ir a /signup", () => {
    mockAuth({ user: null, loading: false });

    renderLoginPage();

    expect(screen.getByRole("link", { name: "Registrate" })).toHaveAttribute("href", "/signup");
  });

  it("sin sesión, muestra el campo Email", () => {
    mockAuth({ user: null, loading: false });

    renderLoginPage();

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("sin sesión, muestra el campo Contraseña", () => {
    mockAuth({ user: null, loading: false });

    renderLoginPage();

    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
  });

  it("completar y enviar el formulario desde la página llama a login() con los datos correctos", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({ user: null, loading: false, login: vi.fn().mockResolvedValue(undefined) });

    renderLoginPage();
    await fillAndSubmit(user);

    expect(auth.login).toHaveBeenCalledWith("hernan@example.com", "clave123");
  });

  it("tras un login exitoso desde la página, termina mostrando el contenido de Home (navegación real)", async () => {
    const user = userEvent.setup();
    mockAuth({ user: null, loading: false, login: vi.fn().mockResolvedValue(undefined) });

    renderLoginPage();
    await fillAndSubmit(user);

    expect(await screen.findByText("Home")).toBeInTheDocument();
  });

  it("si login() falla, la página muestra el mensaje de error traducido", async () => {
    const user = userEvent.setup();
    mockAuth({
      user: null,
      loading: false,
      login: vi.fn().mockRejectedValue(new Error("Email o contraseña incorrectos.")),
    });

    renderLoginPage();
    await fillAndSubmit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Email o contraseña incorrectos.");
  });

  it("loading true tampoco muestra el link a /signup", () => {
    mockAuth({ loading: true });

    renderLoginPage();

    expect(screen.queryByRole("link", { name: "Registrate" })).not.toBeInTheDocument();
  });

  it("el título 'Iniciar sesión' es un encabezado de nivel 1", () => {
    mockAuth({ user: null, loading: false });

    renderLoginPage();

    const heading = screen.getByRole("heading", { name: "Iniciar sesión" });
    expect(heading.tagName).toBe("H1");
  });

  it("con sesión iniciada, no muestra el link a /signup (la página se reemplaza por el redirect)", () => {
    mockAuth({ user: sampleCustomer, loading: false });

    renderLoginPage();

    expect(screen.queryByRole("link", { name: "Registrate" })).not.toBeInTheDocument();
  });

  it("con sesión iniciada, no queda ningún spinner colgado en el DOM", () => {
    mockAuth({ user: sampleCustomer, loading: false });

    renderLoginPage();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("loading tiene prioridad sobre user: con loading true y user ya seteado, igual muestra el spinner (no redirige de más)", () => {
    mockAuth({ user: sampleCustomer, loading: true });

    renderLoginPage();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("Home")).not.toBeInTheDocument();
  });

  it("el link a /signup tiene el texto exacto 'Registrate'", () => {
    mockAuth({ user: null, loading: false });

    renderLoginPage();

    expect(screen.getByText("Registrate")).toBeInTheDocument();
  });

  it("mientras loading es true, no se dispara ninguna llamada a login()", () => {
    const auth = mockAuth({ loading: true });

    renderLoginPage();

    expect(auth.login).not.toHaveBeenCalled();
  });

  it("el mensaje del spinner en esta página es 'Verificando sesión...'", () => {
    mockAuth({ loading: true });

    renderLoginPage();

    expect(screen.getByText("Verificando sesión...")).toBeInTheDocument();
  });

  it("enviar el formulario vacío muestra los errores de campo, integrados en la página", async () => {
    const user = userEvent.setup();
    mockAuth({ user: null, loading: false });

    renderLoginPage();
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(await screen.findByText("El email es obligatorio.")).toBeInTheDocument();
  });

  it("spinner y formulario nunca se muestran a la vez", () => {
    mockAuth({ loading: true });
    const { unmount } = renderLoginPage();
    expect(screen.queryByRole("button", { name: "Iniciar sesión" })).not.toBeInTheDocument();
    unmount();

    mockAuth({ user: null, loading: false });
    renderLoginPage();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("si AuthContext tiene un error de sesión (ej. perfil no encontrado tras un signup interrumpido), la página lo muestra", () => {
    mockAuth({
      user: null,
      loading: false,
      error: "No pudimos cargar tu perfil. Probá iniciar sesión de nuevo en unos segundos.",
    });

    renderLoginPage();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No pudimos cargar tu perfil. Probá iniciar sesión de nuevo en unos segundos."
    );
  });

  it("sin error de sesión, no muestra ningún alert antes de interactuar con el formulario", () => {
    mockAuth({ user: null, loading: false, error: null });

    renderLoginPage();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("tras corregir un error de campo y reenviar con éxito, la página termina mostrando Home", async () => {
    const user = userEvent.setup();
    mockAuth({ user: null, loading: false, login: vi.fn().mockResolvedValue(undefined) });

    renderLoginPage();
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    await screen.findByText("El email es obligatorio.");

    await fillAndSubmit(user);

    expect(await screen.findByText("Home")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { SignupPage } from "./SignupPage";
import { useAuth } from "../contexts/AuthContext";
import type { UserProfile } from "../types/user";

// react-router NO se mockea acá: la navegación es real dentro del
// MemoryRouter, así que podemos probar el flujo completo página + formulario.
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

function renderSignupPage() {
  return render(
    <MemoryRouter initialEntries={["/signup"]}>
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/" element={<p>Home</p>} />
        <Route path="/login" element={<p>Página de login</p>} />
      </Routes>
    </MemoryRouter>
  );
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nombre para mostrar"), "Hernán");
  await user.type(screen.getByLabelText("Email"), "hernan@example.com");
  await user.type(screen.getByLabelText("Contraseña"), "clave123");
  await user.type(screen.getByLabelText("Confirmar contraseña"), "clave123");
  await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
}

const sampleCustomer: UserProfile = {
  uid: "uid-1",
  email: "hernan@example.com",
  displayName: "Hernán",
  role: "customer",
  createdAt: {} as UserProfile["createdAt"],
};

describe("SignupPage", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReset();
  });

  it("mientras loading es true, muestra el spinner y no el formulario", () => {
    mockAuth({ loading: true });

    renderSignupPage();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Crear cuenta" })).not.toBeInTheDocument();
  });

  it("sin sesión, muestra el título y el formulario de registro", () => {
    mockAuth({ user: null, loading: false });

    renderSignupPage();

    expect(screen.getByRole("heading", { name: "Crear cuenta" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear cuenta" })).toBeInTheDocument();
  });

  it("con sesión ya iniciada, redirige a / en vez de mostrar el formulario", () => {
    mockAuth({ user: sampleCustomer, loading: false });

    renderSignupPage();

    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Crear cuenta" })).not.toBeInTheDocument();
  });

  it("muestra un link para ir a /login", () => {
    mockAuth({ user: null, loading: false });

    renderSignupPage();

    expect(screen.getByRole("link", { name: "Iniciá sesión" })).toHaveAttribute("href", "/login");
  });

  it("sin sesión, muestra el campo Nombre para mostrar", () => {
    mockAuth({ user: null, loading: false });

    renderSignupPage();

    expect(screen.getByLabelText("Nombre para mostrar")).toBeInTheDocument();
  });

  it("sin sesión, muestra el campo Email", () => {
    mockAuth({ user: null, loading: false });

    renderSignupPage();

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("completar y enviar el formulario desde la página llama a signup() con los datos correctos", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({ user: null, loading: false, signup: vi.fn().mockResolvedValue(undefined) });

    renderSignupPage();
    await fillAndSubmit(user);

    expect(auth.signup).toHaveBeenCalledWith("hernan@example.com", "clave123", "Hernán");
  });

  it("tras un signup exitoso desde la página, termina mostrando el contenido de Home (navegación real)", async () => {
    const user = userEvent.setup();
    mockAuth({ user: null, loading: false, signup: vi.fn().mockResolvedValue(undefined) });

    renderSignupPage();
    await fillAndSubmit(user);

    expect(await screen.findByText("Home")).toBeInTheDocument();
  });

  it("si signup() falla, la página muestra el mensaje de error traducido", async () => {
    const user = userEvent.setup();
    mockAuth({
      user: null,
      loading: false,
      signup: vi.fn().mockRejectedValue(new Error("Ya existe una cuenta registrada con ese email.")),
    });

    renderSignupPage();
    await fillAndSubmit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe una cuenta registrada con ese email.");
  });

  it("loading true tampoco muestra el link a /login", () => {
    mockAuth({ loading: true });

    renderSignupPage();

    expect(screen.queryByRole("link", { name: "Iniciá sesión" })).not.toBeInTheDocument();
  });

  it("el título 'Crear cuenta' es un encabezado de nivel 1", () => {
    mockAuth({ user: null, loading: false });

    renderSignupPage();

    const heading = screen.getByRole("heading", { name: "Crear cuenta" });
    expect(heading.tagName).toBe("H1");
  });

  it("con sesión iniciada, no muestra el link a /login (la página se reemplaza por el redirect)", () => {
    mockAuth({ user: sampleCustomer, loading: false });

    renderSignupPage();

    expect(screen.queryByRole("link", { name: "Iniciá sesión" })).not.toBeInTheDocument();
  });

  it("con sesión iniciada, no queda ningún spinner colgado en el DOM", () => {
    mockAuth({ user: sampleCustomer, loading: false });

    renderSignupPage();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("loading tiene prioridad sobre user: con loading true y user ya seteado, igual muestra el spinner (no redirige de más)", () => {
    mockAuth({ user: sampleCustomer, loading: true });

    renderSignupPage();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("Home")).not.toBeInTheDocument();
  });

  it("el link a /login tiene el texto exacto 'Iniciá sesión'", () => {
    mockAuth({ user: null, loading: false });

    renderSignupPage();

    expect(screen.getByText("Iniciá sesión")).toBeInTheDocument();
  });

  it("mientras loading es true, no se dispara ninguna llamada a signup()", () => {
    const auth = mockAuth({ loading: true });

    renderSignupPage();

    expect(auth.signup).not.toHaveBeenCalled();
  });

  it("el mensaje del spinner en esta página es 'Verificando sesión...'", () => {
    mockAuth({ loading: true });

    renderSignupPage();

    expect(screen.getByText("Verificando sesión...")).toBeInTheDocument();
  });

  it("enviar el formulario vacío muestra los errores de campo, integrados en la página", async () => {
    const user = userEvent.setup();
    mockAuth({ user: null, loading: false });

    renderSignupPage();
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(await screen.findByText("Ingresá un nombre para mostrar.")).toBeInTheDocument();
  });

  it("spinner y formulario nunca se muestran a la vez", () => {
    mockAuth({ loading: true });
    const { unmount } = renderSignupPage();
    expect(screen.queryByRole("button", { name: "Crear cuenta" })).not.toBeInTheDocument();
    unmount();

    mockAuth({ user: null, loading: false });
    renderSignupPage();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("si AuthContext tiene un error de sesión (ej. perfil no encontrado tras un signup interrumpido), la página lo muestra", () => {
    mockAuth({
      user: null,
      loading: false,
      error: "No pudimos cargar tu perfil. Probá iniciar sesión de nuevo en unos segundos.",
    });

    renderSignupPage();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No pudimos cargar tu perfil. Probá iniciar sesión de nuevo en unos segundos."
    );
  });

  it("sin error de sesión, no muestra ningún alert antes de interactuar con el formulario", () => {
    mockAuth({ user: null, loading: false, error: null });

    renderSignupPage();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("tras corregir contraseñas que no coincidían y reenviar con éxito, la página termina mostrando Home", async () => {
    const user = userEvent.setup();
    mockAuth({ user: null, loading: false, signup: vi.fn().mockResolvedValue(undefined) });

    renderSignupPage();
    await user.type(screen.getByLabelText("Nombre para mostrar"), "Hernán");
    await user.type(screen.getByLabelText("Email"), "hernan@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "otraClave");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await screen.findByText("Las contraseñas no coinciden.");

    await user.clear(screen.getByLabelText("Confirmar contraseña"));
    await user.type(screen.getByLabelText("Confirmar contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(await screen.findByText("Home")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import { Header } from "./Header";
import { useAuth } from "../contexts/AuthContext";
import type { UserProfile } from "../types/user";

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

// El Header ahora muestra el contador del carrito, así que necesita el
// CartProvider además del router. Se usa el wrapper compartido en vez de armar
// la combinación a mano: si mañana el Header consume un provider nuevo, se
// agrega en un solo lugar y todos los tests lo heredan.
function renderHeader() {
  return renderWithProviders(<Header />);
}

const sampleCustomer: UserProfile = {
  uid: "uid-1",
  email: "hernan@example.com",
  displayName: "Hernán",
  role: "customer",
  createdAt: {} as UserProfile["createdAt"],
};

const sampleAdmin: UserProfile = { ...sampleCustomer, uid: "uid-admin", role: "admin" };

describe("Header", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReset();
  });

  it("siempre muestra el link al catálogo, haya o no sesión", () => {
    mockAuth({ user: null });

    renderHeader();

    expect(screen.getByRole("link", { name: "Catálogo" })).toBeInTheDocument();
  });

  it("el link al catálogo apunta a '/'", () => {
    mockAuth({ user: null });

    renderHeader();

    expect(screen.getByRole("link", { name: "Catálogo" })).toHaveAttribute("href", "/");
  });

  it("sin sesión, muestra el link 'Iniciar sesión'", () => {
    mockAuth({ user: null });

    renderHeader();

    expect(screen.getByRole("link", { name: "Iniciar sesión" })).toBeInTheDocument();
  });

  it("el link 'Iniciar sesión' apunta a '/login'", () => {
    mockAuth({ user: null });

    renderHeader();

    expect(screen.getByRole("link", { name: "Iniciar sesión" })).toHaveAttribute("href", "/login");
  });

  it("sin sesión, no muestra el nombre del usuario ni el botón de cerrar sesión", () => {
    mockAuth({ user: null });

    renderHeader();

    expect(screen.queryByText("Hernán")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cerrar sesión/i })).not.toBeInTheDocument();
  });

  it("sin sesión, no muestra el link al panel de administración", () => {
    mockAuth({ user: null });

    renderHeader();

    expect(screen.queryByRole("link", { name: "Panel de administración" })).not.toBeInTheDocument();
  });

  it("con sesión, muestra el nombre del usuario y el botón de cerrar sesión", () => {
    mockAuth({ user: sampleCustomer });

    renderHeader();

    expect(screen.getByText("Hernán")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
  });

  it("con sesión, ya no muestra el link 'Iniciar sesión'", () => {
    mockAuth({ user: sampleCustomer });

    renderHeader();

    expect(screen.queryByRole("link", { name: "Iniciar sesión" })).not.toBeInTheDocument();
  });

  it("con sesión de un customer, NO muestra el link al panel de administración", () => {
    mockAuth({ user: sampleCustomer });

    renderHeader();

    expect(screen.queryByRole("link", { name: "Panel de administración" })).not.toBeInTheDocument();
  });

  it("con sesión de un admin, SÍ muestra el link al panel de administración", () => {
    mockAuth({ user: sampleAdmin });

    renderHeader();

    expect(screen.getByRole("link", { name: "Panel de administración" })).toBeInTheDocument();
  });

  it("un admin también ve su nombre y el botón de cerrar sesión (no es exclusivo de customer)", () => {
    mockAuth({ user: sampleAdmin });

    renderHeader();

    expect(screen.getByText("Hernán")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
  });

  it("con displayName null, usa el email como texto de respaldo", () => {
    mockAuth({ user: { ...sampleCustomer, displayName: null } });

    renderHeader();

    expect(screen.getByText("hernan@example.com")).toBeInTheDocument();
  });

  it("al hacer click en 'Cerrar sesión', llama a logout()", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({ user: sampleCustomer, logout: vi.fn().mockResolvedValue(undefined) });

    renderHeader();
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(auth.logout).toHaveBeenCalledTimes(1);
  });

  it("mientras el logout está en curso, deshabilita el botón y cambia su texto", async () => {
    const user = userEvent.setup();
    let resolveLogout!: () => void;
    const pendingLogout = new Promise<void>((resolve) => {
      resolveLogout = resolve;
    });
    mockAuth({ user: sampleCustomer, logout: vi.fn().mockReturnValue(pendingLogout) });

    renderHeader();
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    const button = screen.getByRole("button", { name: "Cerrando sesión..." });
    expect(button).toBeDisabled();

    resolveLogout();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cerrando sesión..." })).not.toBeInTheDocument());
  });

  it("si logout() falla, muestra el mensaje de error ya traducido (el que viene en error.message)", async () => {
    const user = userEvent.setup();
    mockAuth({
      user: sampleCustomer,
      logout: vi.fn().mockRejectedValue(new Error("Ocurrió un error inesperado. Intentá de nuevo.")),
    });

    renderHeader();
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ocurrió un error inesperado. Intentá de nuevo.");
  });

  it("si logout() falla con algo que no es un Error, muestra un mensaje genérico (no rompe la UI)", async () => {
    const user = userEvent.setup();
    mockAuth({ user: sampleCustomer, logout: vi.fn().mockRejectedValue("fallo desconocido") });

    renderHeader();
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cerrar tu sesión. Probá de nuevo.");
  });

  it("no muestra ningún mensaje de error antes de intentar cerrar sesión", () => {
    mockAuth({ user: sampleCustomer });

    renderHeader();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("un logout exitoso no deja ningún mensaje de error visible", async () => {
    const user = userEvent.setup();
    mockAuth({ user: sampleCustomer, logout: vi.fn().mockResolvedValue(undefined) });

    renderHeader();
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Cerrar sesión" })).not.toBeDisabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("un reintento exitoso limpia el mensaje de error de un intento anterior fallido", async () => {
    const user = userEvent.setup();
    const logout = vi.fn().mockRejectedValueOnce(new Error("Falló la primera vez")).mockResolvedValueOnce(undefined);
    mockAuth({ user: sampleCustomer, logout });

    renderHeader();
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falló la primera vez");

    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("no recibe ninguna prop: toda la información sale de useAuth()", () => {
    mockAuth({ user: sampleAdmin });

    renderWithProviders(
      // @ts-expect-error -- Header no declara props de autenticación (ni ninguna otra).
      <Header user={sampleAdmin} />,
    );

    // Si Header aceptara un prop "user", este test fallaría en tiempo de compilación
    // (@ts-expect-error) antes de llegar a esta aserción en runtime.
    expect(screen.getByText("Hernán")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { LoginForm } from "./LoginForm";
import { useAuth } from "../../contexts/AuthContext";

vi.mock("../../contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const navigateMock = vi.fn();
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useNavigate: () => navigateMock };
});

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

function renderLoginForm() {
  return render(
    <MemoryRouter>
      <LoginForm />
    </MemoryRouter>
  );
}

describe("LoginForm", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReset();
    navigateMock.mockClear();
  });

  it("no llama a login() si el email está vacío (valida antes de tocar Firebase)", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({});
    renderLoginForm();

    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(auth.login).not.toHaveBeenCalled();
    expect(await screen.findByText("El email es obligatorio.")).toBeInTheDocument();
  });

  it("no llama a login() si el email tiene formato inválido", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({});
    renderLoginForm();

    await user.type(screen.getByLabelText("Email"), "no-es-un-email");
    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(auth.login).not.toHaveBeenCalled();
    expect(await screen.findByText("El email no es válido.")).toBeInTheDocument();
  });

  it("no llama a login() si la contraseña está vacía", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({});
    renderLoginForm();

    await user.type(screen.getByLabelText("Email"), "hernan@example.com");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(auth.login).not.toHaveBeenCalled();
    expect(await screen.findByText("La contraseña es obligatoria.")).toBeInTheDocument();
  });

  it("con datos válidos, llama a login() con el email y la contraseña ingresados", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({ login: vi.fn().mockResolvedValue(undefined) });
    renderLoginForm();

    await user.type(screen.getByLabelText("Email"), "hernan@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(auth.login).toHaveBeenCalledWith("hernan@example.com", "clave123");
  });

  it("tras un login exitoso, redirige a '/' con replace", async () => {
    const user = userEvent.setup();
    mockAuth({ login: vi.fn().mockResolvedValue(undefined) });
    renderLoginForm();

    await user.type(screen.getByLabelText("Email"), "hernan@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
  });

  it("mientras se envía, deshabilita los inputs y el botón, y cambia el texto del botón", async () => {
    const user = userEvent.setup();
    let resolveLogin!: () => void;
    const pendingLogin = new Promise<void>((resolve) => {
      resolveLogin = resolve;
    });
    mockAuth({ login: vi.fn().mockReturnValue(pendingLogin) });
    renderLoginForm();

    await user.type(screen.getByLabelText("Email"), "hernan@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.getByLabelText("Contraseña")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Iniciando sesión..." })).toBeDisabled();

    // Resolver la promesa desbloquea el envío y hace que el componente vuelva a
    // isSubmitting: false. Ese cambio de estado tiene que ocurrir DENTRO de
    // act(), y hay que esperarlo: si el test termina antes, React reclama
    // ("not wrapped in act") porque el componente se actualizó cuando el test
    // ya se había dado por finalizado.
    await act(async () => {
      resolveLogin();
    });
  });

  it("si login() falla, muestra el mensaje de error ya traducido y no redirige", async () => {
    const user = userEvent.setup();
    mockAuth({ login: vi.fn().mockRejectedValue(new Error("Email o contraseña incorrectos.")) });
    renderLoginForm();

    await user.type(screen.getByLabelText("Email"), "hernan@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave-mala");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Email o contraseña incorrectos.");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("limpia el error general del intento anterior al reintentar el envío", async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockRejectedValueOnce(new Error("Email o contraseña incorrectos."));
    mockAuth({ login });
    renderLoginForm();

    await user.type(screen.getByLabelText("Email"), "hernan@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave-mala");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email o contraseña incorrectos.");

    login.mockResolvedValueOnce(undefined);
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("después de un error de campo, escribir de nuevo y reenviar limpia ese error si ya es válido", async () => {
    const user = userEvent.setup();
    mockAuth({ login: vi.fn().mockResolvedValue(undefined) });
    renderLoginForm();

    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    expect(await screen.findByText("El email es obligatorio.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Email"), "hernan@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(screen.queryByText("El email es obligatorio.")).not.toBeInTheDocument();
  });

  it("no muestra ningún mensaje de error antes de cualquier intento de envío", () => {
    mockAuth({});
    renderLoginForm();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("el botón arranca habilitado y con el texto 'Iniciar sesión' antes de cualquier interacción", () => {
    mockAuth({});
    renderLoginForm();

    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeEnabled();
  });

  it("un error de validación de campo tampoco dispara la redirección", async () => {
    const user = userEvent.setup();
    mockAuth({});
    renderLoginForm();

    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    await screen.findByText("El email es obligatorio.");

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("si login() falla, los inputs vuelven a habilitarse (no quedan bloqueados para siempre)", async () => {
    const user = userEvent.setup();
    mockAuth({ login: vi.fn().mockRejectedValue(new Error("Email o contraseña incorrectos.")) });
    renderLoginForm();

    await user.type(screen.getByLabelText("Email"), "hernan@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave-mala");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    await screen.findByRole("alert");

    expect(screen.getByLabelText("Email")).toBeEnabled();
    expect(screen.getByLabelText("Contraseña")).toBeEnabled();
  });

  it("si login() falla, el botón vuelve a decir 'Iniciar sesión' (no queda pegado en 'Iniciando sesión...')", async () => {
    const user = userEvent.setup();
    mockAuth({ login: vi.fn().mockRejectedValue(new Error("Email o contraseña incorrectos.")) });
    renderLoginForm();

    await user.type(screen.getByLabelText("Email"), "hernan@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave-mala");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    await screen.findByRole("alert");

    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeInTheDocument();
  });

  it("el campo Email usa autoComplete='email'", () => {
    mockAuth({});
    renderLoginForm();

    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
  });

  it("el campo Contraseña usa autoComplete='current-password' y type='password' (nunca expone el texto)", () => {
    mockAuth({});
    renderLoginForm();

    const passwordInput = screen.getByLabelText("Contraseña");
    expect(passwordInput).toHaveAttribute("autocomplete", "current-password");
    expect(passwordInput).toHaveAttribute("type", "password");
  });

  it("el campo Email es de tipo email", () => {
    mockAuth({});
    renderLoginForm();

    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
  });

  it("el formulario usa noValidate (la validación la controla Zod, no el navegador)", () => {
    mockAuth({});
    const { container } = renderLoginForm();

    expect(container.querySelector("form")).toHaveAttribute("novalidate");
  });

  it("login() se llama con los valores exactos ingresados, sin transformarlos", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({ login: vi.fn().mockResolvedValue(undefined) });
    renderLoginForm();

    await user.type(screen.getByLabelText("Email"), "Hernan.Distinto@Example.com");
    await user.type(screen.getByLabelText("Contraseña"), "ClaveConMayus1");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(auth.login).toHaveBeenCalledWith("Hernan.Distinto@Example.com", "ClaveConMayus1");
  });

  it("si se borra el email después de escribirlo, el envío vuelve a mostrar 'El email es obligatorio.'", async () => {
    const user = userEvent.setup();
    mockAuth({});
    renderLoginForm();

    await user.type(screen.getByLabelText("Email"), "hernan@example.com");
    await user.clear(screen.getByLabelText("Email"));
    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(await screen.findByText("El email es obligatorio.")).toBeInTheDocument();
  });
});

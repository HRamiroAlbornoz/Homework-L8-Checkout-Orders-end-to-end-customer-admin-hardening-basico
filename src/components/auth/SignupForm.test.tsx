import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { SignupForm } from "./SignupForm";
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

function renderSignupForm() {
  return render(
    <MemoryRouter>
      <SignupForm />
    </MemoryRouter>
  );
}

async function fillValidForm(
  user: ReturnType<typeof userEvent.setup>,
  overrides: Partial<{ displayName: string; email: string; password: string; confirmPassword: string }> = {}
) {
  const values = {
    displayName: "Hernán",
    email: "hernan@example.com",
    password: "clave123",
    confirmPassword: "clave123",
    ...overrides,
  };
  await user.type(screen.getByLabelText("Nombre para mostrar"), values.displayName);
  await user.type(screen.getByLabelText("Email"), values.email);
  await user.type(screen.getByLabelText("Contraseña"), values.password);
  await user.type(screen.getByLabelText("Confirmar contraseña"), values.confirmPassword);
}

describe("SignupForm", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReset();
    navigateMock.mockClear();
  });

  it("no llama a signup() si falta el nombre para mostrar", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({});
    renderSignupForm();

    await user.type(screen.getByLabelText("Email"), "hernan@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(auth.signup).not.toHaveBeenCalled();
    expect(await screen.findByText("Ingresá un nombre para mostrar.")).toBeInTheDocument();
  });

  it("no llama a signup() si el email tiene formato inválido", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({});
    renderSignupForm();

    await fillValidForm(user, { email: "no-es-un-email" });
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(auth.signup).not.toHaveBeenCalled();
    expect(await screen.findByText("El email no es válido.")).toBeInTheDocument();
  });

  it("no llama a signup() si la contraseña tiene menos de 8 caracteres", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({});
    renderSignupForm();

    await fillValidForm(user, { password: "abc", confirmPassword: "abc" });
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(auth.signup).not.toHaveBeenCalled();
    expect(await screen.findByText("La contraseña debe tener al menos 8 caracteres.")).toBeInTheDocument();
  });

  it("no llama a signup() si la contraseña no combina letras y números", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({});
    renderSignupForm();

    await fillValidForm(user, { password: "soloLetras", confirmPassword: "soloLetras" });
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(auth.signup).not.toHaveBeenCalled();
    expect(await screen.findByText("La contraseña debe combinar letras y números.")).toBeInTheDocument();
  });

  it("no llama a signup() si las contraseñas no coinciden (se valida antes de tocar Firebase)", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({});
    renderSignupForm();

    await fillValidForm(user, { confirmPassword: "otraClave123" });
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(auth.signup).not.toHaveBeenCalled();
    expect(await screen.findByText("Las contraseñas no coinciden.")).toBeInTheDocument();
  });

  it("con datos válidos, llama a signup() con email, contraseña y nombre", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({ signup: vi.fn().mockResolvedValue(undefined) });
    renderSignupForm();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(auth.signup).toHaveBeenCalledWith("hernan@example.com", "clave123", "Hernán");
  });

  it("tras un signup exitoso, redirige a '/' con replace", async () => {
    const user = userEvent.setup();
    mockAuth({ signup: vi.fn().mockResolvedValue(undefined) });
    renderSignupForm();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
  });

  it("mientras se envía, deshabilita los 4 campos y el botón, y cambia el texto del botón", async () => {
    const user = userEvent.setup();
    let resolveSignup!: () => void;
    const pendingSignup = new Promise<void>((resolve) => {
      resolveSignup = resolve;
    });
    mockAuth({ signup: vi.fn().mockReturnValue(pendingSignup) });
    renderSignupForm();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(screen.getByLabelText("Nombre para mostrar")).toBeDisabled();
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.getByLabelText("Contraseña")).toBeDisabled();
    expect(screen.getByLabelText("Confirmar contraseña")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Creando cuenta..." })).toBeDisabled();

    // Ver la explicación equivalente en LoginForm.test.tsx: resolver la promesa
    // dispara un cambio de estado que hay que esperar dentro de act(), o React
    // avisa que el componente se actualizó después de terminado el test.
    await act(async () => {
      resolveSignup();
    });
  });

  it("si signup() falla (ej. email ya en uso), muestra el mensaje ya traducido y no redirige", async () => {
    const user = userEvent.setup();
    mockAuth({ signup: vi.fn().mockRejectedValue(new Error("Ya existe una cuenta registrada con ese email.")) });
    renderSignupForm();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe una cuenta registrada con ese email.");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("limpia el error general del intento anterior al reintentar el envío", async () => {
    const user = userEvent.setup();
    const signup = vi.fn().mockRejectedValueOnce(new Error("Ya existe una cuenta registrada con ese email."));
    mockAuth({ signup });
    renderSignupForm();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe una cuenta registrada con ese email.");

    signup.mockResolvedValueOnce(undefined);
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("acepta una contraseña de exactamente 8 caracteres con letras y números (límite inferior válido)", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({ signup: vi.fn().mockResolvedValue(undefined) });
    renderSignupForm();

    await fillValidForm(user, { password: "abcd1234", confirmPassword: "abcd1234" });
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(auth.signup).toHaveBeenCalledWith("hernan@example.com", "abcd1234", "Hernán");
  });

  it("no muestra ningún mensaje de error antes de cualquier intento de envío", () => {
    mockAuth({});
    renderSignupForm();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("rechaza confirmPassword vacío como su propio error, distinto del error de 'no coinciden'", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({});
    renderSignupForm();

    await user.type(screen.getByLabelText("Nombre para mostrar"), "Hernán");
    await user.type(screen.getByLabelText("Email"), "hernan@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(auth.signup).not.toHaveBeenCalled();
    expect(await screen.findByText("Confirmá tu contraseña.")).toBeInTheDocument();
  });

  it("no llama a signup() si el email está vacío", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({});
    renderSignupForm();

    await user.type(screen.getByLabelText("Nombre para mostrar"), "Hernán");
    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(auth.signup).not.toHaveBeenCalled();
    expect(await screen.findByText("El email es obligatorio.")).toBeInTheDocument();
  });

  it("si signup() falla, los 4 campos vuelven a habilitarse (no quedan bloqueados para siempre)", async () => {
    const user = userEvent.setup();
    mockAuth({ signup: vi.fn().mockRejectedValue(new Error("Ya existe una cuenta registrada con ese email.")) });
    renderSignupForm();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await screen.findByRole("alert");

    expect(screen.getByLabelText("Nombre para mostrar")).toBeEnabled();
    expect(screen.getByLabelText("Email")).toBeEnabled();
    expect(screen.getByLabelText("Contraseña")).toBeEnabled();
    expect(screen.getByLabelText("Confirmar contraseña")).toBeEnabled();
  });

  it("si signup() falla, el botón vuelve a decir 'Crear cuenta' (no queda pegado en 'Creando cuenta...')", async () => {
    const user = userEvent.setup();
    mockAuth({ signup: vi.fn().mockRejectedValue(new Error("Ya existe una cuenta registrada con ese email.")) });
    renderSignupForm();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await screen.findByRole("alert");

    expect(screen.getByRole("button", { name: "Crear cuenta" })).toBeInTheDocument();
  });

  it("cada campo usa el autoComplete correcto: name, email, new-password (x2)", () => {
    mockAuth({});
    renderSignupForm();

    expect(screen.getByLabelText("Nombre para mostrar")).toHaveAttribute("autocomplete", "name");
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("Confirmar contraseña")).toHaveAttribute("autocomplete", "new-password");
  });

  it("los campos de contraseña son type='password' (nunca exponen el texto en pantalla)", () => {
    mockAuth({});
    renderSignupForm();

    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Confirmar contraseña")).toHaveAttribute("type", "password");
  });

  it("el formulario usa noValidate (la validación la controla Zod, no el navegador)", () => {
    mockAuth({});
    const { container } = renderSignupForm();

    expect(container.querySelector("form")).toHaveAttribute("novalidate");
  });

  it("tras fallar por contraseñas distintas, corregir confirmPassword y reenviar sí llama a signup()", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({ signup: vi.fn().mockResolvedValue(undefined) });
    renderSignupForm();

    await fillValidForm(user, { confirmPassword: "otraClave123" });
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await screen.findByText("Las contraseñas no coinciden.");

    await user.clear(screen.getByLabelText("Confirmar contraseña"));
    await user.type(screen.getByLabelText("Confirmar contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(auth.signup).toHaveBeenCalledWith("hernan@example.com", "clave123", "Hernán");
  });

  it("el displayName se pasa exactamente tal cual fue tipeado, con espacios internos incluidos", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({ signup: vi.fn().mockResolvedValue(undefined) });
    renderSignupForm();

    await fillValidForm(user, { displayName: "María José" });
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(auth.signup).toHaveBeenCalledWith("hernan@example.com", "clave123", "María José");
  });
});

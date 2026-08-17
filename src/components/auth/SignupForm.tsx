import { useState, type SubmitEvent } from "react";
import { useNavigate } from "react-router";
import { treeifyError } from "zod";
import { useAuth } from "../../contexts/AuthContext";
import { signupFormSchema } from "../../lib/authFormSchemas";
import { FormField } from "./FormField";

type FormStatus = "idle" | "loading" | "success" | "error";

interface FieldErrors {
  displayName?: string | undefined;
  email?: string | undefined;
  password?: string | undefined;
  confirmPassword?: string | undefined;
}

export function SignupForm() {
  const { signup } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<FormStatus>("idle");

  const isSubmitting = status === "loading";

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // Limpia el error anterior (de campo o general) apenas el usuario reintenta.
    setFormError(null);
    setFieldErrors({});

    // Las contraseñas se comparan acá (dentro del schema, vía .refine) ANTES
    // de llamar a Firebase: si no coinciden, ni siquiera se intenta el signup.
    const result = signupFormSchema.safeParse({ displayName, email, password, confirmPassword });
    if (!result.success) {
      const tree = treeifyError(result.error);
      setFieldErrors({
        displayName: tree.properties?.displayName?.errors[0],
        email: tree.properties?.email?.errors[0],
        password: tree.properties?.password?.errors[0],
        confirmPassword: tree.properties?.confirmPassword?.errors[0],
      });
      return;
    }

    setStatus("loading");
    try {
      await signup(result.data.email, result.data.password, result.data.displayName);
      setStatus("success");
      // Redirige recién después del await exitoso, nunca en un "finally".
      navigate("/", { replace: true });
    } catch (error) {
      setStatus("error");
      setFormError(error instanceof Error ? error.message : "Ocurrió un error inesperado. Intentá de nuevo.");
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="auth-form">
      <FormField
        id="signup-display-name"
        label="Nombre para mostrar"
        type="text"
        value={displayName}
        onChange={setDisplayName}
        error={fieldErrors.displayName}
        disabled={isSubmitting}
        autoComplete="name"
      />
      <FormField
        id="signup-email"
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
        error={fieldErrors.email}
        disabled={isSubmitting}
        autoComplete="email"
      />
      <FormField
        id="signup-password"
        label="Contraseña"
        type="password"
        value={password}
        onChange={setPassword}
        error={fieldErrors.password}
        disabled={isSubmitting}
        autoComplete="new-password"
      />
      <FormField
        id="signup-confirm-password"
        label="Confirmar contraseña"
        type="password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        error={fieldErrors.confirmPassword}
        disabled={isSubmitting}
        autoComplete="new-password"
      />

      <div aria-live="polite">
        {formError && (
          <p role="alert" className="auth-form__error">
            {formError}
          </p>
        )}
      </div>

      <button type="submit" className="auth-form__submit" disabled={isSubmitting}>
        {isSubmitting ? "Creando cuenta..." : "Crear cuenta"}
      </button>
    </form>
  );
}

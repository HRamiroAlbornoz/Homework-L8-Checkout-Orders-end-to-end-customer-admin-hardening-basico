import { useState, type SubmitEvent } from "react";
import { useNavigate } from "react-router";
import { treeifyError } from "zod";
import { useAuth } from "../../contexts/AuthContext";
import { loginFormSchema } from "../../lib/authFormSchemas";
import { FormField } from "./FormField";

type FormStatus = "idle" | "loading" | "success" | "error";

interface FieldErrors {
  email?: string | undefined;
  password?: string | undefined;
}

export function LoginForm() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<FormStatus>("idle");

  const isSubmitting = status === "loading";

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // Limpia el error anterior (de campo o general) apenas el usuario reintenta.
    setFormError(null);
    setFieldErrors({});

    const result = loginFormSchema.safeParse({ email, password });
    if (!result.success) {
      const tree = treeifyError(result.error);
      setFieldErrors({
        email: tree.properties?.email?.errors[0],
        password: tree.properties?.password?.errors[0],
      });
      return;
    }

    setStatus("loading");
    try {
      await login(result.data.email, result.data.password);
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
        id="login-email"
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
        error={fieldErrors.email}
        disabled={isSubmitting}
        autoComplete="email"
      />
      <FormField
        id="login-password"
        label="Contraseña"
        type="password"
        value={password}
        onChange={setPassword}
        error={fieldErrors.password}
        disabled={isSubmitting}
        autoComplete="current-password"
      />

      <div aria-live="polite">
        {formError && (
          <p role="alert" className="auth-form__error">
            {formError}
          </p>
        )}
      </div>

      <button type="submit" className="auth-form__submit" disabled={isSubmitting}>
        {isSubmitting ? "Iniciando sesión..." : "Iniciar sesión"}
      </button>
    </form>
  );
}

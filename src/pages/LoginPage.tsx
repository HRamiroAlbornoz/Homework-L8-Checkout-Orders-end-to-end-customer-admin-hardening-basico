import { Link, Navigate } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { LoginForm } from "../components/auth/LoginForm";
import { LoadingState } from "../components/states/LoadingState";
import { AUTH_LOADING_MESSAGE } from "../lib/authConstants";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function LoginPage() {
  // Antes de los "return" tempranos: los hooks se ejecutan siempre y en el
  // mismo orden. Esta página tiene dos salidas anticipadas (loading y sesión ya
  // iniciada), así que la regla es fácil de violar sin darse cuenta.
  useDocumentTitle("Iniciar sesión");

  const { user, loading, error } = useAuth();

  // Mismo criterio que ProtectedRoute: loading se chequea ANTES que user,
  // para no decidir nada mientras Firebase todavía está resolviendo la sesión.
  if (loading) {
    return <LoadingState message={AUTH_LOADING_MESSAGE} />;
  }

  // Si ya hay sesión, no tiene sentido mostrar el formulario de login.
  if (user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-card__title">Iniciar sesión</h1>
        {/* Caso borde documentado en docs/auth-notes.md: si AuthContext no pudo
            cargar el perfil (ej. justo después de un signup interrumpido), acá
            es donde el usuario termina — antes ese mensaje nunca se mostraba. */}
        {error && (
          <p role="alert" className="auth-card__error">
            {error}
          </p>
        )}
        <LoginForm />
        <p className="auth-card__footer">
          ¿No tenés cuenta? <Link to="/signup">Registrate</Link>
        </p>
      </div>
    </div>
  );
}

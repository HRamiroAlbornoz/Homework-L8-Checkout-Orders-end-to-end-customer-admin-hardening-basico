import { Link, Navigate } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { SignupForm } from "../components/auth/SignupForm";
import { LoadingState } from "../components/states/LoadingState";
import { AUTH_LOADING_MESSAGE } from "../lib/authConstants";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function SignupPage() {
  // Antes de los "return" tempranos, por la misma regla de hooks que LoginPage.
  useDocumentTitle("Crear cuenta");

  const { user, loading, error } = useAuth();

  // Mismo criterio que ProtectedRoute: loading se chequea ANTES que user,
  // para no decidir nada mientras Firebase todavía está resolviendo la sesión.
  if (loading) {
    return <LoadingState message={AUTH_LOADING_MESSAGE} />;
  }

  // Si ya hay sesión, no tiene sentido mostrar el formulario de registro.
  if (user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-card__title">Crear cuenta</h1>
        {/* Caso borde documentado en docs/auth-notes.md: si AuthContext no pudo
            cargar el perfil (ej. justo después de un signup interrumpido), acá
            es donde el usuario termina — antes ese mensaje nunca se mostraba. */}
        {error && (
          <p role="alert" className="auth-card__error">
            {error}
          </p>
        )}
        <SignupForm />
        <p className="auth-card__footer">
          ¿Ya tenés cuenta? <Link to="/login">Iniciá sesión</Link>
        </p>
      </div>
    </div>
  );
}

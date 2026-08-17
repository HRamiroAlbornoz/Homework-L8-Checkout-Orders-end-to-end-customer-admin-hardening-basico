import { Navigate, Outlet } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { LoadingState } from "../components/states/LoadingState";
import { AUTH_LOADING_MESSAGE } from "../lib/authConstants";

// Protege rutas que requieren sesión iniciada (ej. /cart, /checkout).
//
// El chequeo de "loading" va SIEMPRE antes que "user". Mientras Firebase
// todavía no confirmó el estado real de la sesión, AuthContext expone
// "user: null" como valor inicial (ver AuthContext.tsx) — ese "null" en ese
// momento significa "todavía no se sabe", no "no hay sesión". Si acá se
// evaluara "user" antes que "loading", cualquier usuario ya logueado que
// refresca la página sería redirigido a "/login" por una fracción de
// segundo, hasta que Firebase termine de resolver. El experimento que
// demuestra esto (comentar este chequeo a propósito) está documentado en
// docs/auth-notes.md.
//
// "replace" en el Navigate evita que la entrada de "/cart" (a la que nunca
// se llegó a acceder) quede en el historial: sin esto, el botón "atrás" del
// navegador podría dejar al usuario en un loop "atrás → redirigido → atrás".
export function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingState message={AUTH_LOADING_MESSAGE} />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

import { Navigate, Outlet } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { LoadingState } from "../components/states/LoadingState";
import { AUTH_LOADING_MESSAGE } from "../lib/authConstants";

// Protege rutas restringidas al rol "admin" (por ahora, /admin). Mismo
// orden de chequeos que ProtectedRoute (loading antes que user) y mismo
// motivo: ver el comentario en ProtectedRoute.tsx y el experimento
// documentado en docs/auth-notes.md.
//
// Dos redirecciones distintas según el caso, porque son dos problemas
// distintos: sin sesión (401, "no sé quién sos") va a "/login"; con sesión
// pero sin el rol requerido (403, "sé quién sos, no tenés permiso") va a "/".
export function AdminRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingState message={AUTH_LOADING_MESSAGE} />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

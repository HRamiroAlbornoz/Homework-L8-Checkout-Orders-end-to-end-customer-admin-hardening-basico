import { useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { CartBadge } from "../features/cart/components/CartBadge";

// Toda la información de sesión sale de useAuth(): este componente no recibe
// (ni debe recibir) props relacionadas con autenticación. Ocultar el link de
// admin acá es solo una mejora de UX — la protección real de /admin la hace
// AdminRoute, no este componente.
export function Header() {
  const { user, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  async function handleLogout(): Promise<void> {
    setLogoutError(null);
    setIsLoggingOut(true);
    try {
      await logout();
    } catch (error) {
      setLogoutError(
        error instanceof Error ? error.message : "No pudimos cerrar tu sesión. Probá de nuevo."
      );
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <header className="site-header">
      <nav className="site-header__nav" aria-label="Navegación principal">
        <Link to="/" className="site-header__brand">
          Catálogo
        </Link>

        <div className="site-header__links">
          {/* El carrito se muestra siempre, con o sin sesión: un visitante puede
              armar su carrito antes de registrarse (se guarda en localStorage) y
              recién iniciar sesión al momento de pagar. */}
          <CartBadge />

          {user ? (
            <>
              {user.role === "admin" && (
                <Link to="/admin" className="site-header__link">
                  Panel de administración
                </Link>
              )}
              <span className="site-header__user">{user.displayName ?? user.email}</span>
              <button
                type="button"
                className="site-header__logout"
                onClick={handleLogout}
                disabled={isLoggingOut}
              >
                {isLoggingOut ? "Cerrando sesión..." : "Cerrar sesión"}
              </button>
            </>
          ) : (
            <Link to="/login" className="site-header__link">
              Iniciar sesión
            </Link>
          )}
        </div>
      </nav>

      {logoutError && (
        <p className="site-header__error" role="alert" aria-live="assertive">
          {logoutError}
        </p>
      )}
    </header>
  );
}

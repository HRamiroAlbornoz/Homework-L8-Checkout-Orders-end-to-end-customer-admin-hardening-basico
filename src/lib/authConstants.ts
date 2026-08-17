// Mensaje que se muestra mientras AuthContext todavía no confirmó el estado
// de la sesión ("loading: true"). Se usa en 4 lugares distintos
// (ProtectedRoute, AdminRoute, LoginPage, SignupPage) — vivir en un solo
// lugar evita que un cambio de copy quede desincronizado entre ellos.
export const AUTH_LOADING_MESSAGE = "Verificando sesión...";

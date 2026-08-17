import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "./index.css";
import App from "./App.tsx";
import { AuthProvider } from "./contexts/AuthContext.tsx";
import { CartProvider } from "./features/cart/CartProvider.tsx";

// AuthProvider envuelve toda la app (adentro de BrowserRouter): así useAuth()
// está disponible en cualquier ruta, incluidos el Header y los guards
// (ProtectedRoute/AdminRoute), sin importar qué página esté activa.
//
// CartProvider va DEBAJO de AuthProvider, no al revés. La regla general es que
// un provider tiene que estar por encima de todo lo que necesite consumirlo: la
// sesión es lo más transversal de la app (hasta los guards de ruta dependen de
// ella), y el checkout va a necesitar saber quién es el usuario para asociarle
// la orden. Al revés, el carrito no le hace falta a nadie del lado de la sesión.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <App />
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);

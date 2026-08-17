import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { RootLayout } from "./layouts/RootLayout";
import { ProductsProvider } from "./contexts/ProductsContext";
import { ProductsPage } from "./pages/ProductsPage";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { AdminRoute } from "./routes/AdminRoute";
import { LoadingState } from "./components/states/LoadingState";

// Code splitting por ruta: CartPage, CheckoutPage y AdminPage son páginas
// placeholder que no forman parte del flujo crítico de este homework
// (auth + catálogo). Se cargan bajo demanda con React.lazy() en vez de en el
// bundle inicial, para no crecer el chunk principal con código que la
// mayoría de las visitas nunca ejecuta. Los page components usan named
// exports (consistente con el resto del proyecto), así que se envuelven en
// un .then() que arma el { default } que React.lazy() necesita.
const CartPage = lazy(() =>
  import("./pages/CartPage").then((module) => ({ default: module.CartPage })),
);
const CheckoutPage = lazy(() =>
  import("./pages/CheckoutPage").then((module) => ({ default: module.CheckoutPage })),
);
const AdminPage = lazy(() =>
  import("./pages/AdminPage").then((module) => ({ default: module.AdminPage })),
);

function App() {
  return (
    <Routes>
      <Route element={<RootLayout />}>
        <Route
          index
          element={
            <ProductsProvider>
              <ProductsPage />
            </ProductsProvider>
          }
        />
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignupPage />} />

        {/* El carrito es público: cualquiera puede armar su compra antes de
            registrarse (el contenido vive en localStorage). La sesión recién se
            exige al pagar, que es cuando hace falta saber a quién pertenece la
            orden. Obligar a iniciar sesión para ver el carrito es una fricción
            innecesaria que hace abandonar compras. */}
        <Route
          path="cart"
          element={
            <Suspense fallback={<LoadingState message="Cargando página..." />}>
              <CartPage />
            </Suspense>
          }
        />

        <Route element={<ProtectedRoute />}>
          <Route
            path="checkout"
            element={
              <Suspense fallback={<LoadingState message="Cargando página..." />}>
                <CheckoutPage />
              </Suspense>
            }
          />
        </Route>

        <Route element={<AdminRoute />}>
          <Route
            path="admin"
            element={
              <Suspense fallback={<LoadingState message="Cargando página..." />}>
                <AdminPage />
              </Suspense>
            }
          />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default App;

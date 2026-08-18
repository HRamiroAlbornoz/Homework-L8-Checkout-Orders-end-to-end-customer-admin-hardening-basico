import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { RootLayout } from "./layouts/RootLayout";
import { AdminLayout } from "./layouts/AdminLayout";
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
const OrdersPage = lazy(() =>
  import("./pages/OrdersPage").then((module) => ({ default: module.OrdersPage })),
);
const OrderDetailPage = lazy(() =>
  import("./pages/OrderDetailPage").then((module) => ({ default: module.OrderDetailPage })),
);
const AdminOrdersPage = lazy(() =>
  import("./pages/AdminOrdersPage").then((module) => ({ default: module.AdminOrdersPage })),
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

          {/* El historial de compras es privado por definición: solo tiene
              sentido con sesión iniciada, y las reglas de Firestore además
              impiden leer órdenes ajenas. El guard acá es UX (evita una
              pantalla de error); la protección real está en las reglas. */}
          <Route
            path="orders"
            element={
              <Suspense fallback={<LoadingState message="Cargando página..." />}>
                <OrdersPage />
              </Suspense>
            }
          />

          {/* El segmento ":orderId" tiene que llamarse igual que la clave que
              OrderDetailPage lee con useParams. Si no coinciden, la página
              recibe undefined y muestra "no encontrada" sin ninguna pista. */}
          <Route
            path="orders/:orderId"
            element={
              <Suspense fallback={<LoadingState message="Cargando página..." />}>
                <OrderDetailPage />
              </Suspense>
            }
          />
        </Route>

        {/* El guard se declara UNA sola vez, en el padre: cada sección nueva
            del panel lo hereda sin tener que acordarse de repetirlo.
            AdminLayout aporta el marco común (título y navegación) y delega el
            contenido a la sección con <Outlet />. */}
        <Route element={<AdminRoute />}>
          <Route path="admin" element={<AdminLayout />}>
            <Route
              index
              element={
                <Suspense fallback={<LoadingState message="Cargando página..." />}>
                  <AdminPage />
                </Suspense>
              }
            />
            <Route
              path="orders"
              element={
                <Suspense fallback={<LoadingState message="Cargando página..." />}>
                  <AdminOrdersPage />
                </Suspense>
              }
            />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default App;

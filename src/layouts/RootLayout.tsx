import { Outlet } from "react-router";
import { Header } from "../components/Header";

// Layout compartido por todas las rutas de la app: Header se define una sola
// vez acá y el contenido de cada ruta se renderiza en <Outlet />.
export function RootLayout() {
  return (
    <>
      <Header />
      <main>
        <Outlet />
      </main>
    </>
  );
}

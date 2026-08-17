import { NavLink, Outlet } from "react-router";

/**
 * Marco común de todas las pantallas del panel de administración.
 *
 * Existe para que el control de acceso y la navegación del panel se declaren UNA
 * sola vez. Sin este layout, cada pantalla nueva del panel tendría que acordarse
 * de repetir el guard de AdminRoute — y basta con que una se olvide para dejar
 * una sección administrativa abierta a cualquiera.
 *
 * Acá el layout va acompañado de anidar la URL (/admin, /admin/orders), porque
 * la jerarquía es real: las órdenes del panel SON una sección del panel. No
 * siempre es así — a veces conviene compartir marco sin sumar segmentos a la URL.
 */
export function AdminLayout() {
  return (
    <div className="page admin-layout">
      {/*
        El <h1> vive acá y no en cada pantalla: es el título del panel, y las
        secciones son subtítulos suyos. Así la jerarquía de encabezados que
        recorre un lector de pantalla refleja la estructura real.
      */}
      <h1>Panel de administración</h1>

      {/*
        aria-label distingue esta navegación de la principal del sitio: un lector
        de pantalla lista las regiones de navegación por su nombre, y dos <nav>
        sin nombre serían "navegación" y "navegación".
      */}
      <nav className="admin-layout__nav" aria-label="Secciones del panel">
        {/*
          NavLink marca el enlace activo con aria-current="page", que es lo que
          le dice a un lector de pantalla en qué sección está parado. Un <a>
          común solo se vería distinto, sin comunicar nada.

          "end" es necesario en el primero: sin él, /admin también se marcaría
          como activo estando en /admin/orders, porque es un prefijo suyo.
        */}
        <NavLink to="/admin" end className="admin-layout__link">
          Productos
        </NavLink>
        <NavLink to="/admin/orders" className="admin-layout__link">
          Órdenes
        </NavLink>
      </nav>

      <Outlet />
    </div>
  );
}

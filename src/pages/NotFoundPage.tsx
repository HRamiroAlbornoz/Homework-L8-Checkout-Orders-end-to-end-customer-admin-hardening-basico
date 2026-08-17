import { Link } from "react-router";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

// Antes esta página era solo un título, y eso la convertía en un callejón sin
// salida: alguien que llega desde un enlace roto se queda sin ninguna acción
// visible. El resto de las pantallas vacías del proyecto (el carrito sin
// productos, el checkout sin nada que comprar) sí ofrecen un camino de vuelta;
// esta había quedado afuera de ese criterio.
export function NotFoundPage() {
  useDocumentTitle("Página no encontrada");

  return (
    <div className="page">
      <h1>Página no encontrada</h1>
      <p className="not-found__message">
        La dirección que abriste no existe o el producto que buscabas ya no está
        disponible.
      </p>
      <Link to="/" className="not-found__link">
        Volver al catálogo
      </Link>
    </div>
  );
}

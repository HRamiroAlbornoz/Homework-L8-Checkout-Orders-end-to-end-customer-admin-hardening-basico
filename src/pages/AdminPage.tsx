import { CreateProductForm } from "../features/admin/components/CreateProductForm";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

// Sección de productos del panel de administración. La protección real de esta
// ruta la hacen dos capas independientes: AdminRoute (que no la renderiza si el
// rol no es "admin") y las reglas de Firestore + la Vercel Function del presign
// (que rechazan la escritura y la subida aunque alguien llame a las APIs por
// fuera de la UI).
//
// Ya no trae su propio <h1> ni el contenedor .page: los aporta AdminLayout, que
// es el marco común de todas las secciones del panel. El encabezado de esta
// sección es un <h2>, un nivel por debajo del título del panel.
//
// Por ahora solo permite dar de alta productos. Editar y eliminar quedan como
// trabajo futuro: no forman parte del alcance de esta homework.
export function AdminPage() {
  useDocumentTitle("Productos · Panel de administración");

  return (
    <section className="admin-page">
      <h2>Alta de productos</h2>
      <CreateProductForm />
    </section>
  );
}

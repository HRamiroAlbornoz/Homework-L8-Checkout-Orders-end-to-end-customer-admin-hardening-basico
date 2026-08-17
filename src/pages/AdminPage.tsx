import { CreateProductForm } from "../features/admin/components/CreateProductForm";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

// Panel de administración. La protección real de esta ruta la hacen dos capas
// independientes: AdminRoute (que no la renderiza si el rol no es "admin") y las
// reglas de Firestore + la Vercel Function del presign (que rechazan la
// escritura y la subida aunque alguien llame a las APIs por fuera de la UI).
//
// Por ahora solo permite dar de alta productos. Editar y eliminar quedan como
// trabajo futuro: no forman parte del alcance de este release candidate.
export function AdminPage() {
  useDocumentTitle("Panel de administración");

  return (
    <div className="page admin-page">
      <h1>Panel de administración</h1>
      <CreateProductForm />
    </div>
  );
}

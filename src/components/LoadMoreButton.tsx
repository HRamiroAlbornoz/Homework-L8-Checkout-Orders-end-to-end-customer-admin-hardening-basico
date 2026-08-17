interface LoadMoreButtonProps {
  hasMore: boolean;
  loading: boolean;
  onClick: () => void;
}

// Si no hay más páginas, el botón directamente no se renderiza (en vez de
// mostrarse deshabilitado sin motivo aparente para el usuario).
export function LoadMoreButton({ hasMore, loading, onClick }: LoadMoreButtonProps) {
  if (!hasMore) return null;

  return (
    <button type="button" onClick={onClick} disabled={loading} className="load-more-button">
      {loading ? "Cargando..." : "Cargar más"}
    </button>
  );
}

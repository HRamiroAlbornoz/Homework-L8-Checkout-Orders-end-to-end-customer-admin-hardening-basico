interface EmptyStateProps {
  message: string;
}

// Componente puro: no decide el texto, solo lo muestra. Quien lo usa (la página)
// arma el mensaje según el contexto (sin productos vs. sin resultados de búsqueda).
export function EmptyState({ message }: EmptyStateProps) {
  return (
    <div className="state state--empty" role="status" aria-live="polite">
      <p>{message}</p>
    </div>
  );
}

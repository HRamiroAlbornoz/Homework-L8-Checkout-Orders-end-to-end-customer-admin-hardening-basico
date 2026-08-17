interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

// role="alert" ya implica una región "assertive": el lector de pantalla
// interrumpe para avisar el error apenas aparece (a diferencia de "status").
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="state state--error" role="alert">
      <p>{message}</p>
      <button type="button" onClick={onRetry} aria-label="Reintentar la consulta de productos">
        Reintentar
      </button>
    </div>
  );
}

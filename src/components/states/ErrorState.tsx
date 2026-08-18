interface ErrorStateProps {
  message: string;
  onRetry: () => void;
  /**
   * Qué anuncia el lector de pantalla al llegar al botón.
   *
   * Existe porque el texto visible dice solo "Reintentar", que fuera de
   * contexto no dice reintentar QUÉ. Cada pantalla completa esa frase con lo
   * suyo ("la consulta de productos", "la carga de tus órdenes"): antes estaba
   * fijo en "productos" y se anunciaba así también en pantallas donde no hay
   * ningún producto.
   */
  retryLabel?: string;
}

// role="alert" ya implica una región "assertive": el lector de pantalla
// interrumpe para avisar el error apenas aparece (a diferencia de "status").
export function ErrorState({ message, onRetry, retryLabel = "Reintentar" }: ErrorStateProps) {
  return (
    <div className="state state--error" role="alert">
      <p>{message}</p>
      <button type="button" onClick={onRetry} aria-label={retryLabel}>
        Reintentar
      </button>
    </div>
  );
}

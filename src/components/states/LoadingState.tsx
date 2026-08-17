interface LoadingStateProps {
  message?: string;
}

// role="status" + aria-live="polite": un lector de pantalla anuncia este texto
// sin interrumpir lo que el usuario esté haciendo (a diferencia de "alert").
export function LoadingState({ message = "Cargando productos..." }: LoadingStateProps) {
  return (
    <div className="state state--loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

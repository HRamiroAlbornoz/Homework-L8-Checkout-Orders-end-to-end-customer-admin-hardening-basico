import { useState, useEffect } from "react";

const DEFAULT_DELAY_MS = 400;

// Devuelve una versión "retrasada" de `value`: solo se actualiza cuando pasan
// `delayMs` milisegundos sin que `value` vuelva a cambiar. Sirve para no disparar
// una consulta a Firestore en cada tecla que el usuario tipea en el buscador.
export function useDebounce<T>(value: T, delayMs: number = DEFAULT_DELAY_MS): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = setTimeout(() => setDebouncedValue(value), delayMs);

    // Cleanup: si `value` cambia antes de que se cumpla el delay (el usuario
    // sigue tipeando), cancelamos el timeout anterior para no acumular timers.
    return () => clearTimeout(timeoutId);
  }, [value, delayMs]);

  return debouncedValue;
}

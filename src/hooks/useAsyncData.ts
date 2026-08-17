import { useCallback, useEffect, useState } from "react";

/**
 * Estado de una carga asíncrona, como unión discriminada.
 *
 * El campo "status" es el que discrimina: dentro de un `if (state.status ===
 * "success")` el compilador SABE que existe state.data, y que NO existe
 * state.error. Con tres campos sueltos (data, error, isLoading) nada impediría
 * leer data mientras todavía carga —sería null— ni olvidarse de contemplar el
 * error; acá el compilador obliga a cubrir los tres casos.
 */
export type AsyncState<T> =
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: Error };

/** Lo que devuelve el hook: el estado más la forma de volver a pedir los datos. */
export type AsyncData<T> = AsyncState<T> & { reload: () => void };

/** Envuelve cualquier valor lanzado en un Error, porque en JavaScript se puede lanzar cualquier cosa. */
function normalizeError(thrown: unknown): Error {
  return thrown instanceof Error
    ? thrown
    : new Error("No pudimos completar la operación. Intentá de nuevo en unos minutos.");
}

/**
 * Carga datos asíncronos manejando los tres estados y cancelando al desmontar.
 *
 * @param load  función que trae los datos. DEBE estar memorizada con useCallback
 *              por quien llama (ver la nota de abajo).
 * @returns     el estado actual y una función reload() para volver a pedirlos.
 *
 * ⚠ SOBRE `load` Y useCallback
 *
 * El efecto depende de `load`. Si quien llama pasa una función creada en el
 * cuerpo del componente (`useAsyncData(() => getOrdersByUser(uid))`), esa
 * función es un objeto NUEVO en cada render: el efecto la ve distinta, vuelve a
 * ejecutarse, actualiza el estado, provoca otro render, y así en un bucle
 * infinito de llamadas a Firestore —que además se cobran—.
 *
 * Por eso los hooks de este proyecto que lo usan (useCustomerOrders,
 * useOrderDetail, useAdminOrders) memorizan `load` con useCallback antes de
 * pasarlo. Las páginas no tienen que preocuparse por esto.
 */
export function useAsyncData<T>(load: () => Promise<T>): AsyncData<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });

  // Contador que sirve solo para forzar que el efecto vuelva a correr cuando
  // alguien llama a reload(). Cambiar un número es la manera más simple de
  // decirle a un useEffect "ejecutate de nuevo" sin tocar sus otras
  // dependencias.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    // Firestore NO soporta AbortController: getDocs() no acepta un signal, así
    // que la request no se puede cancelar de verdad. Lo que sí se puede evitar
    // —y es el problema real— es actualizar el estado de un componente que ya
    // no está en pantalla. Este flag se pone en true al desmontar, y la
    // respuesta que llegue tarde se descarta.
    //
    // Sin esto, entrar al detalle de una orden y volver atrás antes de que
    // responda produce una advertencia de React y, peor, puede pisar el estado
    // de la pantalla nueva con datos de la vieja.
    let cancelled = false;

    async function run(): Promise<void> {
      setState({ status: "loading" });

      try {
        const data = await load();

        if (!cancelled) {
          setState({ status: "success", data });
        }
      } catch (error) {
        if (!cancelled) {
          setState({ status: "error", error: normalizeError(error) });
        }
      }
    }

    // void marca que la promesa se ignora a propósito: un useEffect no puede ser
    // async (tiene que devolver la función de limpieza, no una promesa), y los
    // errores ya se manejan dentro del try/catch.
    void run();

    return () => {
      cancelled = true;
    };
  }, [load, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return { ...state, reload };
}

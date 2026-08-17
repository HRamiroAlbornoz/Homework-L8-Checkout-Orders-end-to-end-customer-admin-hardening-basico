import { FirebaseError } from "firebase/app";
import { ORDER_ERROR_CODES, type OrderErrorCode } from "./orderErrorCodes";

/**
 * Error estructurado de órdenes: { code, message, retryable }.
 *
 * Mismo criterio que AuthError (ver authErrors.ts): "code" es el contrato
 * estable, "message" es el texto humano que se muestra, y "cause" preserva el
 * error original para debug interno sin exponerlo nunca al usuario.
 *
 * "retryable" se suma acá porque la diferencia importa de verdad: ante un
 * problema de red conviene ofrecer "Reintentar", mientras que ante un carrito
 * vacío, un permiso denegado o un índice faltante reintentar solo repetiría el
 * mismo error. Sin este dato, quien consume el error tiene que adivinar.
 */
export class OrderError extends Error {
  readonly code: OrderErrorCode;
  readonly retryable: boolean;

  constructor(
    code: OrderErrorCode,
    message: string,
    options?: ErrorOptions & { retryable?: boolean },
  ) {
    super(message, options);
    this.name = "OrderError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

/**
 * Traduce cualquier error que pueda salir de Firestore al operar con órdenes
 * (crear, listar, leer o actualizar) en un OrderError con mensaje en español.
 *
 * Nunca se deja pasar el error crudo: los mensajes del SDK están en inglés, son
 * técnicos, y a veces revelan detalles internos (nombres de colecciones, reglas)
 * que no deberían llegar a la pantalla del usuario.
 */
export function mapOrderError(error: unknown): OrderError {
  // Un OrderError ya mapeado (por ejemplo, el de "carrito vacío" que lanza el
  // propio service) se devuelve tal cual, sin volver a envolverlo.
  if (error instanceof OrderError) {
    return error;
  }

  if (error instanceof FirebaseError) {
    // ------------------------------------------------------------------
    // Índice compuesto faltante
    // ------------------------------------------------------------------
    //
    // Firestore lo reporta como "failed-precondition", pero ese código también
    // cubre otras precondiciones que no tienen nada que ver. Por eso, además
    // del código, se busca el texto "index" en el mensaje: sin esa segunda
    // comprobación, un failed-precondition de otra causa se reportaría como un
    // problema de índices y mandaría el diagnóstico para el lado equivocado.
    //
    // El error original que queda en "cause" incluye el link directo que crea
    // el índice en la consola de Firebase: ahí está la solución concreta.
    if (error.code === "failed-precondition" && error.message.toLowerCase().includes("index")) {
      return new OrderError(
        ORDER_ERROR_CODES.MISSING_INDEX,
        "No pudimos ordenar los resultados en este momento. Es un problema de configuración nuestro, no tuyo: ya estamos al tanto.",
        // retryable: false a propósito. El índice tarda un par de minutos en
        // construirse, así que un reintento inmediato falla igual. Ofrecer el
        // botón "Reintentar" acá solo produciría el mismo error una y otra vez.
        { cause: error, retryable: false },
      );
    }

    // ------------------------------------------------------------------
    // Permisos
    // ------------------------------------------------------------------
    //
    // El mensaje cambió respecto del proyecto anterior, y el motivo importa.
    //
    // En el L7 las reglas verificaban el precio de cada ítem contra el
    // catálogo, así que la causa más frecuente de un rechazo era que un precio
    // hubiera cambiado mientras el producto estaba en el carrito; el mensaje
    // mandaba a revisarlo. Esa regla ya no existe: el modelo de esta homework
    // guarda los ítems como un array, y las reglas de Firestore no pueden
    // recorrer arrays para comparar precios.
    //
    // Mantener aquel texto mandaría al usuario a revisar un carrito que no
    // tiene nada malo, mientras la causa real queda oculta. Hoy las causas
    // posibles son: la sesión expiró, o se intentó tocar una orden ajena. El
    // mensaje apunta a la primera, que es la única accionable por el usuario.
    //
    // Deliberadamente NO se menciona la existencia de órdenes de otros: quien
    // esté probando accesos ajenos no debe recibir confirmación de nada.
    if (error.code === "permission-denied" || error.code === "unauthenticated") {
      return new OrderError(
        ORDER_ERROR_CODES.PERMISSION_DENIED,
        "No tenés permiso para hacer esta operación. Es posible que tu sesión haya expirado: volvé a iniciar sesión e intentá de nuevo.",
        { cause: error },
      );
    }

    // ------------------------------------------------------------------
    // Red
    // ------------------------------------------------------------------
    if (error.code === "unavailable" || error.code === "deadline-exceeded") {
      return new OrderError(
        ORDER_ERROR_CODES.NETWORK_ERROR,
        "No pudimos conectarnos con el servidor. Revisá tu conexión e intentá de nuevo.",
        { cause: error, retryable: true },
      );
    }
  }

  return new OrderError(
    ORDER_ERROR_CODES.UNKNOWN_ERROR,
    "No pudimos completar la operación. Intentá de nuevo en unos minutos.",
    { cause: error, retryable: true },
  );
}

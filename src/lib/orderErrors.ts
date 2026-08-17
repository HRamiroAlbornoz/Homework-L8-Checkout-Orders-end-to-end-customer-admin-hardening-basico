import { FirebaseError } from "firebase/app";
import { ORDER_ERROR_CODES, type OrderErrorCode } from "./orderErrorCodes";

/**
 * Error estructurado del checkout: { code, message, retryable }.
 *
 * Mismo criterio que AuthError (ver authErrors.ts): "code" es el contrato
 * estable, "message" es el texto humano que se muestra, y "cause" preserva el
 * error original para debug interno sin exponerlo nunca al usuario.
 *
 * "retryable" se suma acá porque en el checkout la diferencia importa de verdad:
 * ante un problema de red conviene ofrecer "Reintentar", mientras que ante un
 * carrito vacío o un permiso denegado reintentar solo repetiría el mismo error.
 * Sin este dato, quien consume el error tiene que adivinar.
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
 * Traduce cualquier error que pueda salir de Firestore al crear una orden en un
 * OrderError con mensaje en español.
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
    if (error.code === "permission-denied") {
      // El mensaje cambió cuando las reglas empezaron a verificar el precio de
      // cada ítem contra el catálogo.
      //
      // Antes, un rechazo de permisos acá casi siempre significaba un problema
      // de sesión, y el mensaje mandaba a iniciar sesión de nuevo. Ahora la
      // causa más frecuente es otra y mucho más inocente: el precio de un
      // producto cambió mientras estaba en el carrito, así que el precio
      // guardado ya no coincide con el del catálogo y Firestore rechaza la
      // escritura.
      //
      // El mensaje apunta a esa causa —volver al carrito y revisarlo—, que es
      // una acción que el usuario puede hacer y que efectivamente resuelve el
      // problema. Mandarlo a iniciar sesión de nuevo lo haría dar vueltas sin
      // llegar a ningún lado.
      //
      // Deliberadamente NO se menciona la verificación de precios: quien haya
      // manipulado su carrito no debe enterarse de qué fue lo que se detectó.
      return new OrderError(
        ORDER_ERROR_CODES.PERMISSION_DENIED,
        "No pudimos confirmar la compra. Es posible que algún precio haya cambiado: volvé al carrito, revisalo y probá de nuevo.",
        { cause: error },
      );
    }

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
    "No pudimos confirmar tu compra. Intentá de nuevo en unos minutos.",
    { cause: error, retryable: true },
  );
}

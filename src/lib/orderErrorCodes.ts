// Códigos propios para los errores del checkout, en un solo lugar y con "as
// const", siguiendo el mismo criterio que authErrorCodes.ts: el "code" es el
// contrato estable que el resto de la app puede usar para tomar decisiones
// programáticas, sin depender del texto del "message" (que está en español,
// está pensado para mostrarse, y puede reescribirse sin romper nada).
//
// La lista es corta a propósito. Inflar la jerarquía con un código por cada
// variante concreta (ORDER_ITEMS_EMPTY, ORDER_TOTAL_MISMATCH, ...) obliga al
// frontend a conocer un vocabulario enorme para hacer siempre lo mismo: mostrar
// un mensaje. La especificidad va en el "message".
export const ORDER_ERROR_CODES = {
  /** Falta algo del lado del cliente para poder crear la orden (carrito vacío, sin sesión). */
  INVALID_ORDER: "INVALID_ORDER",
  /** No se pudo llegar al servidor. Es el único caso donde reintentar tiene sentido. */
  NETWORK_ERROR: "NETWORK_ERROR",
  /** Firestore rechazó la escritura por reglas de seguridad. */
  PERMISSION_DENIED: "PERMISSION_DENIED",
  /** Cualquier otra cosa. Existe para que nunca se muestre un error crudo al usuario. */
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

export type OrderErrorCode = (typeof ORDER_ERROR_CODES)[keyof typeof ORDER_ERROR_CODES];

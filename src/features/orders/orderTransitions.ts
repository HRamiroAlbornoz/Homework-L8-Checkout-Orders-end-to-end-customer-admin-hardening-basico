import type { OrderStatus } from "@/types/order";

// ============================================================================
// MÁQUINA DE ESTADOS DE UNA ORDEN
// ============================================================================
//
// Declarar los cuatro valores posibles de "status" NO impide que una orden pase
// de "completed" de vuelta a "pending". Un enum dice qué valores existen; no dice
// cuáles son alcanzables desde dónde. Esa segunda parte es lo que define este
// archivo.
//
//   pending ──────► processing ──────► completed   (terminal)
//      │                  │
//      └──────────────────┴──────────► cancelled   (terminal)
//
// "completed" y "cancelled" son ESTADOS TERMINALES: una vez ahí, la orden no se
// mueve más. Una compra entregada no vuelve a estar pendiente, y una cancelada
// no se "descancela" — si el cliente vuelve a querer el producto, eso es una
// orden nueva, no la resurrección de la vieja.
export const ORDER_TRANSITIONS = {
  pending: ["processing", "cancelled"],
  processing: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
} as const satisfies Record<OrderStatus, readonly OrderStatus[]>;

// Por qué "satisfies" y no una anotación de tipo con dos puntos:
//
// Con "satisfies", TypeScript verifica que el objeto cumpla el Record —o sea,
// que estén las cuatro claves— PERO conserva los tipos literales de cada valor.
// Si mañana se agregara un quinto estado a OrderStatus (por ejemplo "refunded"),
// este archivo DEJA DE COMPILAR hasta que alguien defina sus transiciones.
//
// Ese error de compilación es el punto de todo el archivo: obliga a pensar el
// nuevo estado en vez de que quede silenciosamente inalcanzable, que es como se
// cuelan los bugs de máquinas de estado.

/**
 * Estados a los que se puede pasar desde el estado actual.
 *
 * @param current  estado en el que está la orden hoy.
 * @returns        lista de destinos válidos; vacía si el estado es terminal.
 *
 * La usa la UI del panel de administración para construir el selector: si
 * devuelve una lista vacía, no se ofrece ninguna acción de cambio.
 */
export function getAllowedTransitions(current: OrderStatus): readonly OrderStatus[] {
  return ORDER_TRANSITIONS[current];
}

/**
 * Indica si el cambio de un estado a otro está permitido.
 *
 * @param current  estado actual de la orden.
 * @param next     estado al que se la quiere mover.
 * @returns        true solo si la transición está declarada arriba.
 *
 * Notar que pasar un estado a SÍ MISMO devuelve false: no está en ninguna lista.
 * Es deliberado — una escritura que no cambia nada igual cuesta dinero, dispara
 * la evaluación de las reglas y pisa "updatedAt" con una modificación que nunca
 * ocurrió.
 */
export function canTransition(current: OrderStatus, next: OrderStatus): boolean {
  // El paso por una variable intermedia no es decorativo. ORDER_TRANSITIONS
  // conserva tipos literales (por el "as const"), así que ORDER_TRANSITIONS.pending
  // es del tipo readonly ["processing", "cancelled"], y su .includes() solo
  // acepta esos dos valores exactos. Pasarle un OrderStatus cualquiera no
  // compilaría. Al ensanchar el tipo acá —una asignación segura, sin ningún
  // "as"— el .includes() vuelve a aceptar los cuatro estados.
  const allowed: readonly OrderStatus[] = ORDER_TRANSITIONS[current];

  return allowed.includes(next);
}

/**
 * Indica si la orden llegó a un estado del que ya no puede salir.
 *
 * @param status  estado a evaluar.
 * @returns       true para "completed" y "cancelled".
 */
export function isTerminalStatus(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

// ============================================================================
// DECISIONES TOMADAS AL DEFINIR ESTA MÁQUINA
// ============================================================================
//
// 1. ¿QUIÉN PUEDE DISPARAR UNA TRANSICIÓN?
//    Solo el administrador. El cliente no puede cancelar su propia orden, ni
//    siquiera mientras está en "pending". No es un olvido: las reglas de
//    Firestore permiten el update únicamente a un admin, y agregar un camino
//    para el cliente exigiría una regla distinta (dueño + solo hacia
//    "cancelled" + solo desde "pending"). Queda fuera del alcance de esta
//    homework, pero es el primer lugar donde crecería.
//
// 2. ¿QUÉ PASA CON UNA ORDEN QUE QUEDA EN "pending" PARA SIEMPRE?
//    Hoy, nada: se queda ahí hasta que un admin la mire. No hay vencimiento
//    automático porque eso necesitaría un proceso de servidor programado
//    (Cloud Functions), que el enunciado excluye explícitamente. El panel de
//    administración las lista ordenadas por fecha, así que las más viejas
//    quedan visibles al filtrar por "pending".
//
// 3. ¿HAY ALGÚN INVARIANTE QUE REVALIDAR AL TRANSICIONAR?
//    En este proyecto no. El caso típico sería el stock —confirmar una orden
//    debería descontar unidades y fallar si no alcanzan—, pero el catálogo no
//    maneja stock. Si se agregara, el descuento tendría que ir en una
//    transacción junto con el cambio de estado, nunca como dos escrituras
//    sueltas que pueden quedar a mitad de camino.
//
// 4. ESTA VALIDACIÓN SE REPITE EN firestore.rules, Y ESO ESTÁ BIEN.
//    Deshabilitar una opción en el <select> ayuda al usuario honesto, pero no
//    detiene a nadie que llame al SDK desde la consola del navegador. La copia
//    de las reglas es la que se aplica de verdad; esta existe para dar un error
//    entendible antes de gastar una llamada a la red. Si se cambian las
//    transiciones acá, HAY QUE CAMBIARLAS TAMBIÉN EN LAS REGLAS.

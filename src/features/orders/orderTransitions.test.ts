import { describe, it, expect } from "vitest";
import { orderStatusSchema, type OrderStatus } from "@/types/order";
import {
  canTransition,
  getAllowedTransitions,
  isTerminalStatus,
  ORDER_TRANSITIONS,
} from "./orderTransitions";

// Todas las combinaciones posibles de estado origen → estado destino.
//
// Se generan a partir del enum en vez de escribirse a mano: si mañana se agrega
// un quinto estado, la matriz crece sola y los tests de abajo empiezan a
// evaluarlo automáticamente. Una lista escrita a mano se quedaría vieja en
// silencio, que es exactamente el fallo que estos tests deberían atrapar.
const TODOS_LOS_ESTADOS = orderStatusSchema.options;

const TODAS_LAS_COMBINACIONES: Array<[OrderStatus, OrderStatus]> = TODOS_LOS_ESTADOS.flatMap(
  (origen) => TODOS_LOS_ESTADOS.map((destino): [OrderStatus, OrderStatus] => [origen, destino]),
);

// Las únicas transiciones que el negocio permite. Escritas a mano A PROPÓSITO,
// sin derivarlas de ORDER_TRANSITIONS: si el test leyera la misma estructura que
// está probando, pasaría siempre —incluso con la máquina de estados mal— porque
// estaría comparando el código consigo mismo.
const TRANSICIONES_ESPERADAS = new Set([
  "pending→processing",
  "pending→cancelled",
  "processing→completed",
  "processing→cancelled",
]);

describe("canTransition — matriz completa de estados", () => {
  it.each(TODAS_LAS_COMBINACIONES)("de %s a %s", (origen, destino) => {
    const deberiaPermitirse = TRANSICIONES_ESPERADAS.has(`${origen}→${destino}`);

    expect(canTransition(origen, destino)).toBe(deberiaPermitirse);
  });
});

describe("canTransition — casos que importan", () => {
  it("no permite volver atrás desde un estado terminal", () => {
    // Una compra entregada no vuelve a estar pendiente, y una cancelada no se
    // "descancela": si el cliente la quiere de nuevo, eso es una orden nueva.
    expect(canTransition("completed", "pending")).toBe(false);
    expect(canTransition("completed", "processing")).toBe(false);
    expect(canTransition("cancelled", "pending")).toBe(false);
    expect(canTransition("cancelled", "processing")).toBe(false);
  });

  it("no permite pasar de un estado terminal al otro", () => {
    expect(canTransition("completed", "cancelled")).toBe(false);
    expect(canTransition("cancelled", "completed")).toBe(false);
  });

  it("no permite saltearse el estado intermedio", () => {
    // Una orden no puede darse por completada sin haber pasado por preparación.
    expect(canTransition("pending", "completed")).toBe(false);
  });

  it("no permite cambiar un estado por sí mismo", () => {
    // Una escritura que no cambia nada igual cuesta dinero, dispara la
    // evaluación de las reglas y pisa updatedAt con una modificación que nunca
    // ocurrió.
    for (const estado of TODOS_LOS_ESTADOS) {
      expect(canTransition(estado, estado)).toBe(false);
    }
  });
});

describe("isTerminalStatus", () => {
  it("reconoce los dos estados finales", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
  });

  it("no marca como final un estado del que todavía se puede salir", () => {
    expect(isTerminalStatus("pending")).toBe(false);
    expect(isTerminalStatus("processing")).toBe(false);
  });
});

describe("getAllowedTransitions", () => {
  it("devuelve los destinos posibles desde cada estado", () => {
    expect(getAllowedTransitions("pending")).toEqual(["processing", "cancelled"]);
    expect(getAllowedTransitions("processing")).toEqual(["completed", "cancelled"]);
  });

  it("devuelve una lista vacía en los estados finales", () => {
    // Es lo que hace que el panel de administración no ofrezca ninguna acción
    // sobre una orden ya cerrada.
    expect(getAllowedTransitions("completed")).toEqual([]);
    expect(getAllowedTransitions("cancelled")).toEqual([]);
  });
});

describe("ORDER_TRANSITIONS — integridad de la estructura", () => {
  it("define transiciones para TODOS los estados del enum", () => {
    // El "satisfies" del archivo ya garantiza esto en tiempo de compilación.
    // El test lo cubre igual porque la garantía se pierde si alguien agrega el
    // estado y "resuelve" el error de tipos poniendo una lista vacía sin
    // pensarlo: ahí compilaría, pero el estado quedaría inalcanzable.
    for (const estado of TODOS_LOS_ESTADOS) {
      expect(ORDER_TRANSITIONS).toHaveProperty(estado);
    }
  });

  it("no declara ningún destino que no sea un estado válido", () => {
    for (const destinos of Object.values(ORDER_TRANSITIONS)) {
      for (const destino of destinos) {
        expect(orderStatusSchema.safeParse(destino).success).toBe(true);
      }
    }
  });

  it("deja todos los estados alcanzables desde el estado inicial", () => {
    // Recorrido en anchura desde "pending". Un estado al que no se puede llegar
    // por ningún camino es código muerto: existiría en el enum, en las reglas y
    // en la interfaz, pero ninguna orden llegaría nunca a tenerlo.
    const alcanzados = new Set<OrderStatus>(["pending"]);
    const porVisitar: OrderStatus[] = ["pending"];

    while (porVisitar.length > 0) {
      const actual = porVisitar.shift();

      if (!actual) {
        break;
      }

      for (const destino of getAllowedTransitions(actual)) {
        if (!alcanzados.has(destino)) {
          alcanzados.add(destino);
          porVisitar.push(destino);
        }
      }
    }

    expect(alcanzados.size).toBe(TODOS_LOS_ESTADOS.length);
  });
});

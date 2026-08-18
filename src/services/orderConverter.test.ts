import { describe, it, expect, vi } from "vitest";
import { Timestamp, type QueryDocumentSnapshot, type SnapshotOptions } from "firebase/firestore";
import { makeOrder } from "@/test/fixtures";
import type { OrderDoc } from "@/types/order";
import { orderConverter } from "./orderConverter";

// Acá NO se mockea firebase/firestore, a diferencia de ordersService.test.ts.
// El motivo: lo que se está probando es justamente la conversión desde la clase
// Timestamp REAL del SDK. Con un Timestamp falso, el test comprobaría que
// nuestro doble funciona, no que la conversión funciona.
//
// Es seguro: Timestamp es una clase de datos pura, no abre ninguna conexión.

const FECHA_DE_COMPRA = new Date("2026-01-15T10:30:00.000Z");
const FECHA_DE_ACTUALIZACION = new Date("2026-01-16T09:00:00.000Z");

function documentoValido(): Record<string, unknown> {
  return {
    userId: "uid-1",
    items: [{ productId: "p-1", name: "Nike Air Max 90", priceAtPurchase: 100, quantity: 2 }],
    total: 200,
    status: "pending",
    createdAt: Timestamp.fromDate(FECHA_DE_COMPRA),
  };
}

/**
 * Imita el snapshot que Firestore le pasa al converter.
 *
 * @param datos            lo que devuelve snapshot.data().
 * @param registrarOpciones  callback opcional para inspeccionar las opciones recibidas.
 *
 * El "as unknown as" es inevitable y está acotado a esta única función:
 * QueryDocumentSnapshot es una clase interna del SDK que no se puede construir
 * desde afuera. Mismo criterio que los "as never" de ordersService.test.ts.
 */
function snapshotFalso(
  datos: Record<string, unknown>,
  registrarOpciones?: (opciones: SnapshotOptions | undefined) => void,
): QueryDocumentSnapshot<OrderDoc> {
  return {
    id: "orden-1",
    data: (opciones?: SnapshotOptions) => {
      registrarOpciones?.(opciones);
      return datos;
    },
  } as unknown as QueryDocumentSnapshot<OrderDoc>;
}

describe("orderConverter — lectura", () => {
  it("convierte el Timestamp de Firestore en un Date de JavaScript", () => {
    const orden = orderConverter.fromFirestore(snapshotFalso(documentoValido()));

    // El SDK modular SIEMPRE devuelve Timestamp y no ofrece ninguna opción para
    // que devuelva Date. Si esta conversión no ocurriera acá, cada pantalla que
    // muestre una fecha tendría que acordarse de llamar a .toDate().
    expect(orden.createdAt).toBeInstanceOf(Date);
    expect(orden.createdAt.getTime()).toBe(FECHA_DE_COMPRA.getTime());
  });

  it("toma el id del snapshot, no del contenido del documento", () => {
    // El id no es un campo del documento: viaja aparte. Si el converter lo
    // buscara adentro, todas las órdenes quedarían con el id undefined.
    const orden = orderConverter.fromFirestore(snapshotFalso(documentoValido()));

    expect(orden.id).toBe("orden-1");
  });

  it("pide una estimación para los timestamps que el servidor todavía no confirmó", () => {
    const registrar = vi.fn();

    orderConverter.fromFirestore(snapshotFalso(documentoValido(), registrar));

    // ESTE ES EL TEST QUE PREVIENE UN BUG INTERMITENTE.
    //
    // Por defecto, data() devuelve NULL en los campos escritos con
    // serverTimestamp() mientras la escritura no llegó al servidor. En esa
    // ventana, el schema fallaría con "se esperaba un Timestamp" justo después
    // de crear una orden — el momento exacto en que el usuario entra a ver su
    // historial. Y desaparecería solo, lo que lo hace casi imposible de
    // reproducir a mano.
    expect(registrar).toHaveBeenCalledWith({ serverTimestamps: "estimate" });
  });

  it("mantiene los ítems tal como se guardaron", () => {
    const orden = orderConverter.fromFirestore(snapshotFalso(documentoValido()));

    expect(orden.items).toEqual([
      { productId: "p-1", name: "Nike Air Max 90", priceAtPurchase: 100, quantity: 2 },
    ]);
    expect(orden.total).toBe(200);
    expect(orden.status).toBe("pending");
    expect(orden.userId).toBe("uid-1");
  });
});

describe("orderConverter — el campo opcional updatedAt", () => {
  it("OMITE la propiedad cuando la orden nunca fue actualizada", () => {
    const orden = orderConverter.fromFirestore(snapshotFalso(documentoValido()));

    // No alcanza con que valga undefined: con exactOptionalPropertyTypes activo,
    // "ausente" y "presente con valor undefined" son cosas distintas, y la
    // pantalla de detalle decide si mostrar la fila según exista o no.
    expect(orden).not.toHaveProperty("updatedAt");
  });

  it("la incluye como Date cuando la orden fue actualizada", () => {
    const orden = orderConverter.fromFirestore(
      snapshotFalso({
        ...documentoValido(),
        updatedAt: Timestamp.fromDate(FECHA_DE_ACTUALIZACION),
      }),
    );

    expect(orden.updatedAt).toBeInstanceOf(Date);
    expect(orden.updatedAt?.getTime()).toBe(FECHA_DE_ACTUALIZACION.getTime());
  });
});

describe("orderConverter — validación del documento", () => {
  // Firestore no valida NADA al leer. Un documento escrito por una versión
  // anterior de la app, o editado a mano desde la consola, llega con la forma
  // que sea. Estos tests comprueban que Zod lo detecte en el borde, en vez de
  // dejar que un dato roto se propague por la aplicación.

  it("rechaza un documento sin createdAt", () => {
    // Se borra la propiedad en vez de desestructurarla e ignorarla: una variable
    // asignada y nunca usada es un error de lint, y silenciarlo con un guion
    // bajo solo esconde el ruido en vez de eliminarlo.
    const sinFecha = documentoValido();
    delete sinFecha.createdAt;

    expect(() => orderConverter.fromFirestore(snapshotFalso(sinFecha))).toThrow();
  });

  it("rechaza un createdAt que no sea un Timestamp de Firestore", () => {
    expect(() =>
      orderConverter.fromFirestore(
        snapshotFalso({ ...documentoValido(), createdAt: "2026-01-15" }),
      ),
    ).toThrow();
  });

  it("rechaza un estado que no sea uno de los cuatro válidos", () => {
    expect(() =>
      orderConverter.fromFirestore(snapshotFalso({ ...documentoValido(), status: "pagada" })),
    ).toThrow();
  });

  it("rechaza una orden sin ítems", () => {
    // Una orden sin ítems es una compra de nada: si llegara a existir, sería un
    // síntoma de un bug al escribir, y taparlo al leer lo volvería invisible.
    expect(() =>
      orderConverter.fromFirestore(snapshotFalso({ ...documentoValido(), items: [] })),
    ).toThrow();
  });

  it("rechaza un ítem sin el precio de compra", () => {
    expect(() =>
      orderConverter.fromFirestore(
        snapshotFalso({
          ...documentoValido(),
          items: [{ productId: "p-1", name: "Nike", quantity: 1 }],
        }),
      ),
    ).toThrow();
  });

  it("rechaza una cantidad que no sea un entero positivo", () => {
    expect(() =>
      orderConverter.fromFirestore(
        snapshotFalso({
          ...documentoValido(),
          items: [{ productId: "p-1", name: "Nike", priceAtPurchase: 100, quantity: 0 }],
        }),
      ),
    ).toThrow();
  });
});

describe("orderConverter — escritura", () => {
  it("lanza si alguien intenta escribir con él", () => {
    // El converter es de solo lectura a propósito: al crear una orden, createdAt
    // no es un Timestamp sino el centinela de serverTimestamp(). Lanzar hace que
    // un uso indebido falle en el acto, en vez de guardar un documento
    // incompleto que nadie note hasta mucho después.
    // Se le pasa una orden porque la firma de FirestoreDataConverter la exige,
    // aunque nuestra implementación la ignore y lance de inmediato.
    expect(() => orderConverter.toFirestore(makeOrder())).toThrow(/solo lectura/i);
  });
});

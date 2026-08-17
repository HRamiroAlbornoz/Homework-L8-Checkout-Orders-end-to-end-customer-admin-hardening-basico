import { describe, it, expect, beforeEach, vi } from "vitest";
import { FirebaseError } from "firebase/app";
import { makeCartItem } from "@/test/fixtures";
import type { CartState } from "@/features/cart/types";
import { MAX_ITEMS_PER_ORDER, type Order } from "@/types/order";

// Nunca se toca Firestore real: se mockean la conexión y las funciones del SDK,
// para poder inspeccionar exactamente QUÉ se escribe, con qué contenido y sobre
// qué documento.
//
// Eso es lo que hay que verificar acá. El modelo de esta homework guarda los
// ítems y el total DENTRO del documento de la orden, y las reglas de Firestore
// ya no pueden comprobar los precios contra el catálogo. Si el service dejara de
// calcular el total y volviera a copiar el del carrito, ningún otro test lo
// notaría.
vi.mock("@/lib/firebase", () => ({ db: { __marca: "db" } }));

// Timestamp se incluye en el mock porque types/order.ts lo importa como VALOR
// (lo usa en un instanceof). Sin él, el módulo no cargaría.
vi.mock("firebase/firestore", () => {
  // El campo se declara y se asigna por separado: el tsconfig tiene activo
  // "erasableSyntaxOnly", que prohíbe los parameter properties
  // (constructor(readonly x: number)) porque son sintaxis que TypeScript
  // convierte en código, y no simple anotación que se pueda borrar.
  class TimestampFalso {
    seconds: number;

    constructor(seconds: number) {
      this.seconds = seconds;
    }

    toDate(): Date {
      return new Date(this.seconds * 1000);
    }
  }

  return {
    Timestamp: TimestampFalso,
    collection: vi.fn(),
    doc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    serverTimestamp: vi.fn(() => "MARCA_DE_TIEMPO_DEL_SERVIDOR"),
    // Las restricciones se guardan como objetos planos para poder afirmar sobre
    // ellas: interesa comprobar que la consulta filtra y ordena por lo que
    // corresponde, no cómo el SDK las representa internamente.
    where: vi.fn((campo: string, operador: string, valor: unknown) => ({
      tipo: "where",
      campo,
      operador,
      valor,
    })),
    orderBy: vi.fn((campo: string, direccion: string) => ({ tipo: "orderBy", campo, direccion })),
    query: vi.fn((referencia: unknown, ...restricciones: unknown[]) => ({
      tipo: "consulta",
      referencia,
      restricciones,
    })),
  };
});

import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import {
  createOrderFromCart,
  createOrderId,
  getOrderById,
  getOrdersByUser,
  listOrders,
  ORDERS_COLLECTION,
  updateOrderStatus,
} from "./ordersService";

// ---------------------------------------------------------------------------
// Dobles de las referencias del SDK
// ---------------------------------------------------------------------------
//
// Los "as never" son inevitables: las firmas reales devuelven clases del propio
// Firestore que no se pueden construir en un test. Se acotan a estas dos
// fábricas, en lugar de repartirse por todo el archivo.

interface DocumentoFalso {
  tipo: "documento";
  id: string;
  withConverter: () => DocumentoFalso;
}

interface ColeccionFalsa {
  tipo: "coleccion";
  ruta: string;
  withConverter: () => ColeccionFalsa;
}

function crearDocumentoFalso(id: string): DocumentoFalso {
  const documento: DocumentoFalso = {
    tipo: "documento",
    id,
    // withConverter devuelve la misma referencia: así el test puede comparar por
    // identidad la referencia que se leyó con la que se escribió.
    withConverter: () => documento,
  };
  return documento;
}

function crearColeccionFalsa(ruta: string): ColeccionFalsa {
  const coleccion: ColeccionFalsa = {
    tipo: "coleccion",
    ruta,
    withConverter: () => coleccion,
  };
  return coleccion;
}

/** Imita el snapshot de un documento leído, ya pasado por el converter. */
function snapshotFalso(orden: Order | null) {
  return {
    exists: () => orden !== null,
    data: () => orden,
    id: orden?.id ?? "sin-id",
  };
}

/** Imita el resultado de getDocs(): una colección de snapshots. */
function resultadoDeConsulta(ordenes: Order[]) {
  return { docs: ordenes.map((orden) => ({ data: () => orden })) };
}

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------

const carritoConDosProductos: CartState = {
  items: [
    makeCartItem({ productId: "p-1", name: "Nike Air Max 90", unitPrice: 100, quantity: 2 }),
    makeCartItem({ productId: "p-2", name: "Adidas Gazelle", unitPrice: 50, quantity: 1 }),
  ],
  totalItems: 3,
  totalPrice: 250,
};

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "orden-1",
    userId: "uid-1",
    items: [{ productId: "p-1", name: "Nike Air Max 90", priceAtPurchase: 100, quantity: 2 }],
    total: 200,
    status: "pending",
    createdAt: new Date("2026-01-15T10:00:00Z"),
    ...overrides,
  };
}

/** Devuelve la última llamada a setDoc() ya tipada. */
function ultimaEscritura(): [DocumentoFalso, Record<string, unknown>] {
  const llamadas = vi.mocked(setDoc).mock.calls;
  return llamadas[llamadas.length - 1] as unknown as [DocumentoFalso, Record<string, unknown>];
}

beforeEach(() => {
  vi.clearAllMocks();

  let contadorDeIdsGenerados = 0;

  vi.mocked(collection).mockImplementation(
    (_padre: unknown, ruta?: string) => crearColeccionFalsa(ruta ?? ORDERS_COLLECTION) as never,
  );

  vi.mocked(doc).mockImplementation((...argumentos: unknown[]) => {
    // doc(coleccion) — sin id: es createOrderId() generando uno nuevo.
    if (argumentos.length === 1) {
      contadorDeIdsGenerados += 1;
      return crearDocumentoFalso(`id-generado-${contadorDeIdsGenerados}`) as never;
    }

    // doc(db, "orders", orderId) — referencia a un documento concreto.
    const [, , id] = argumentos as [unknown, string, string];
    return crearDocumentoFalso(id) as never;
  });

  vi.mocked(setDoc).mockResolvedValue(undefined);
  vi.mocked(updateDoc).mockResolvedValue(undefined);
});

// ===========================================================================
// createOrderId
// ===========================================================================

describe("createOrderId", () => {
  it("genera un id sin escribir nada en Firestore", () => {
    const id = createOrderId();

    expect(id).toBeTruthy();
    // Es la propiedad que hace posible la idempotencia: tener el id ANTES de
    // escribir. Si generarlo costara una escritura, no habría nada que reusar.
    expect(setDoc).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// createOrderFromCart — validaciones previas
// ===========================================================================

describe("createOrderFromCart — validaciones antes de tocar la red", () => {
  it("rechaza un carrito vacío con un mensaje entendible", async () => {
    await expect(
      createOrderFromCart("uid-1", { items: [], totalItems: 0, totalPrice: 0 }, "orden-1"),
    ).rejects.toThrow(/carrito vacío/i);

    // No se escribe nada: el error se detecta antes, no se descubre por un
    // rechazo de Firestore que llegaría con un mensaje de permisos genérico.
    expect(setDoc).not.toHaveBeenCalled();
  });

  it("rechaza una compra sin usuario", async () => {
    await expect(createOrderFromCart("", carritoConDosProductos, "orden-1")).rejects.toThrow(
      /iniciar sesión/i,
    );

    expect(setDoc).not.toHaveBeenCalled();
  });

  it("rechaza un carrito con más productos distintos que el máximo permitido", async () => {
    const carritoEnorme: CartState = {
      items: Array.from({ length: MAX_ITEMS_PER_ORDER + 1 }, (_, indice) =>
        makeCartItem({ productId: `p-${indice}`, unitPrice: 10, quantity: 1 }),
      ),
      totalItems: MAX_ITEMS_PER_ORDER + 1,
      totalPrice: (MAX_ITEMS_PER_ORDER + 1) * 10,
    };

    await expect(createOrderFromCart("uid-1", carritoEnorme, "orden-1")).rejects.toThrow(
      new RegExp(String(MAX_ITEMS_PER_ORDER)),
    );

    expect(setDoc).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// createOrderFromCart — qué se escribe
// ===========================================================================

describe("createOrderFromCart — qué se escribe", () => {
  it("escribe UN solo documento, con los ítems adentro", async () => {
    await createOrderFromCart("uid-1", carritoConDosProductos, "orden-1");

    expect(setDoc).toHaveBeenCalledTimes(1);

    const [, documento] = ultimaEscritura();
    expect(documento.items).toHaveLength(2);
  });

  it("guarda cada ítem como snapshot, con priceAtPurchase en vez de unitPrice", async () => {
    await createOrderFromCart("uid-1", carritoConDosProductos, "orden-1");

    const [, documento] = ultimaEscritura();

    // El renombre importa: en la orden el precio es HISTÓRICO, no el del
    // catálogo de hoy. Guardar la foto completa (nombre y precio) es lo que
    // permite mostrar el historial sin volver a leer products.
    expect(documento.items).toEqual([
      { productId: "p-1", name: "Nike Air Max 90", priceAtPurchase: 100, quantity: 2 },
      { productId: "p-2", name: "Adidas Gazelle", priceAtPurchase: 50, quantity: 1 },
    ]);
  });

  it("calcula el total en vez de copiar el del carrito", async () => {
    // El carrito dice 999999, pero sus ítems suman 250. El carrito vive en
    // localStorage y se puede editar desde las devtools: su total no es
    // confiable. El que se guarda tiene que salir de las líneas de la orden.
    const carritoConTotalMentiroso: CartState = {
      ...carritoConDosProductos,
      totalPrice: 999999,
    };

    await createOrderFromCart("uid-1", carritoConTotalMentiroso, "orden-1");

    const [, documento] = ultimaEscritura();
    expect(documento.total).toBe(250);
  });

  it("redondea el total a dos decimales", async () => {
    // 0.1 * 3 da 0.30000000000000004 en JavaScript. Sin redondeo explícito, ese
    // número terminaría guardado tal cual en la base.
    const carritoConDecimales: CartState = {
      items: [makeCartItem({ productId: "p-1", unitPrice: 0.1, quantity: 3 })],
      totalItems: 3,
      totalPrice: 0.3,
    };

    await createOrderFromCart("uid-1", carritoConDecimales, "orden-1");

    const [, documento] = ultimaEscritura();
    expect(documento.total).toBe(0.3);
  });

  it("el estado inicial siempre es 'pending', no lo decide quien llama", async () => {
    await createOrderFromCart("uid-1", carritoConDosProductos, "orden-1");

    const [, documento] = ultimaEscritura();
    expect(documento.status).toBe("pending");
  });

  it("la fecha la pone el servidor, no el reloj del navegador", async () => {
    await createOrderFromCart("uid-1", carritoConDosProductos, "orden-1");

    const [, documento] = ultimaEscritura();
    // Con new Date(), la fecha saldría del reloj del usuario: manipulable, y el
    // orden cronológico del historial dejaría de ser confiable.
    expect(documento.createdAt).toBe("MARCA_DE_TIEMPO_DEL_SERVIDOR");
  });

  it("guarda el userId de quien compra", async () => {
    await createOrderFromCart("uid-1", carritoConDosProductos, "orden-1");

    const [, documento] = ultimaEscritura();
    expect(documento.userId).toBe("uid-1");
  });
});

// ===========================================================================
// createOrderFromCart — idempotencia
// ===========================================================================

describe("createOrderFromCart — idempotencia", () => {
  it("escribe sobre el id que recibe, y lo devuelve", async () => {
    const idDevuelto = await createOrderFromCart("uid-1", carritoConDosProductos, "orden-elegida");

    const [referencia] = ultimaEscritura();
    expect(referencia.id).toBe("orden-elegida");
    expect(idDevuelto).toBe("orden-elegida");
  });

  it("dos intentos con el mismo id escriben sobre el mismo documento", async () => {
    vi.mocked(setDoc).mockRejectedValueOnce(new FirebaseError("unavailable", "Backend unavailable"));

    await expect(
      createOrderFromCart("uid-1", carritoConDosProductos, "orden-1"),
    ).rejects.toThrow();

    // El reintento usa el MISMO id, que es lo que evita la orden duplicada.
    await createOrderFromCart("uid-1", carritoConDosProductos, "orden-1");

    const idsEscritos = vi
      .mocked(setDoc)
      .mock.calls.map((llamada) => (llamada[0] as unknown as DocumentoFalso).id);

    expect(idsEscritos).toEqual(["orden-1", "orden-1"]);
  });

  it("si la orden ya se había escrito, el reintento se resuelve como éxito", async () => {
    // El caso borde real: el primer intento SÍ escribió, pero se cortó la red
    // antes de recibir la respuesta. Al reintentar, ese setDoc deja de ser un
    // "create" para las reglas y pasa a ser un "update", que el customer no
    // puede hacer. Sin este manejo, vería PERMISSION_DENIED por una orden que
    // en realidad se creó bien.
    vi.mocked(setDoc).mockRejectedValue(
      new FirebaseError("permission-denied", "Missing or insufficient permissions."),
    );
    vi.mocked(getDoc).mockResolvedValue(
      snapshotFalso(makeOrder({ id: "orden-1", userId: "uid-1" })) as never,
    );

    await expect(createOrderFromCart("uid-1", carritoConDosProductos, "orden-1")).resolves.toBe(
      "orden-1",
    );
  });

  it("si el documento no existe, el rechazo de permisos se propaga", async () => {
    vi.mocked(setDoc).mockRejectedValue(
      new FirebaseError("permission-denied", "Missing or insufficient permissions."),
    );
    vi.mocked(getDoc).mockResolvedValue(snapshotFalso(null) as never);

    await expect(
      createOrderFromCart("uid-1", carritoConDosProductos, "orden-1"),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("no da por buena una orden existente que es de otro usuario", async () => {
    // Sin esta comprobación, adivinar el id de una orden ajena haría que el
    // checkout respondiera "listo, tu compra está registrada" mostrando el id
    // de la compra de otra persona.
    vi.mocked(setDoc).mockRejectedValue(
      new FirebaseError("permission-denied", "Missing or insufficient permissions."),
    );
    vi.mocked(getDoc).mockResolvedValue(
      snapshotFalso(makeOrder({ id: "orden-1", userId: "OTRO-USUARIO" })) as never,
    );

    await expect(
      createOrderFromCart("uid-1", carritoConDosProductos, "orden-1"),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});

// ===========================================================================
// createOrderFromCart — errores
// ===========================================================================

describe("createOrderFromCart — errores", () => {
  it("nunca deja pasar el mensaje crudo del SDK", async () => {
    vi.mocked(setDoc).mockRejectedValue(
      new FirebaseError("permission-denied", "Missing or insufficient permissions."),
    );
    vi.mocked(getDoc).mockResolvedValue(snapshotFalso(null) as never);

    await expect(
      createOrderFromCart("uid-1", carritoConDosProductos, "orden-1"),
    ).rejects.not.toThrow(/insufficient permissions/i);
  });

  it("marca como reintentable un fallo de red, y no un rechazo de permisos", async () => {
    vi.mocked(setDoc).mockRejectedValue(new FirebaseError("unavailable", "Backend unavailable"));

    // "retryable" es lo que le permite a quien consume el error decidir si
    // ofrecer un botón de reintentar o no. Sin ese dato tendría que adivinar.
    await expect(
      createOrderFromCart("uid-1", carritoConDosProductos, "orden-1"),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR", retryable: true });
  });
});

// ===========================================================================
// getOrdersByUser
// ===========================================================================

describe("getOrdersByUser", () => {
  it("filtra por userId y ordena por fecha descendente", async () => {
    vi.mocked(getDocs).mockResolvedValue(resultadoDeConsulta([makeOrder()]) as never);

    await getOrdersByUser("uid-1");

    const consulta = vi.mocked(getDocs).mock.calls[0]?.[0] as unknown as {
      restricciones: Array<Record<string, unknown>>;
    };

    expect(consulta.restricciones).toEqual([
      { tipo: "where", campo: "userId", operador: "==", valor: "uid-1" },
      { tipo: "orderBy", campo: "createdAt", direccion: "desc" },
    ]);
  });

  it("devuelve las órdenes que trae la consulta", async () => {
    const ordenes = [makeOrder({ id: "a" }), makeOrder({ id: "b" })];
    vi.mocked(getDocs).mockResolvedValue(resultadoDeConsulta(ordenes) as never);

    await expect(getOrdersByUser("uid-1")).resolves.toEqual(ordenes);
  });

  it("devuelve una lista vacía cuando el usuario no tiene órdenes", async () => {
    vi.mocked(getDocs).mockResolvedValue(resultadoDeConsulta([]) as never);

    await expect(getOrdersByUser("uid-1")).resolves.toEqual([]);
  });

  it("traduce el índice compuesto faltante a un código propio", async () => {
    // Firestore lo reporta como failed-precondition. Distinguirlo de un error
    // desconocido es lo que permite mostrar un mensaje honesto en vez de
    // invitar a reintentar algo que va a fallar igual.
    vi.mocked(getDocs).mockRejectedValue(
      new FirebaseError("failed-precondition", "The query requires an index. You can create it..."),
    );

    await expect(getOrdersByUser("uid-1")).rejects.toMatchObject({
      code: "MISSING_INDEX",
      retryable: false,
    });
  });
});

// ===========================================================================
// listOrders
// ===========================================================================

describe("listOrders", () => {
  it("sin filtro, solo ordena por fecha descendente", async () => {
    vi.mocked(getDocs).mockResolvedValue(resultadoDeConsulta([]) as never);

    await listOrders();

    const consulta = vi.mocked(getDocs).mock.calls[0]?.[0] as unknown as {
      restricciones: Array<Record<string, unknown>>;
    };

    expect(consulta.restricciones).toEqual([
      { tipo: "orderBy", campo: "createdAt", direccion: "desc" },
    ]);
  });

  it("con filtro, agrega el where por estado y mantiene el mismo orden", async () => {
    vi.mocked(getDocs).mockResolvedValue(resultadoDeConsulta([]) as never);

    await listOrders({ status: "processing" });

    const consulta = vi.mocked(getDocs).mock.calls[0]?.[0] as unknown as {
      restricciones: Array<Record<string, unknown>>;
    };

    // El orden es el mismo con y sin filtro: si cambiara, la lista se
    // reacomodaría al filtrar y desorientaría a quien la está mirando.
    expect(consulta.restricciones).toEqual([
      { tipo: "where", campo: "status", operador: "==", valor: "processing" },
      { tipo: "orderBy", campo: "createdAt", direccion: "desc" },
    ]);
  });
});

// ===========================================================================
// getOrderById
// ===========================================================================

describe("getOrderById", () => {
  it("devuelve la orden cuando existe", async () => {
    const orden = makeOrder({ id: "orden-7" });
    vi.mocked(getDoc).mockResolvedValue(snapshotFalso(orden) as never);

    await expect(getOrderById("orden-7")).resolves.toEqual(orden);
  });

  it("devuelve null cuando no existe, en vez de lanzar", async () => {
    vi.mocked(getDoc).mockResolvedValue(snapshotFalso(null) as never);

    await expect(getOrderById("no-existe")).resolves.toBeNull();
  });

  it("propaga el rechazo de permisos al pedir una orden ajena", async () => {
    vi.mocked(getDoc).mockRejectedValue(
      new FirebaseError("permission-denied", "Missing or insufficient permissions."),
    );

    await expect(getOrderById("orden-ajena")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });
});

// ===========================================================================
// updateOrderStatus
// ===========================================================================

describe("updateOrderStatus", () => {
  it("aplica una transición válida", async () => {
    vi.mocked(getDoc).mockResolvedValue(snapshotFalso(makeOrder({ status: "pending" })) as never);

    await updateOrderStatus("orden-1", "processing");

    expect(updateDoc).toHaveBeenCalledTimes(1);
  });

  it("manda SOLO status y updatedAt", async () => {
    vi.mocked(getDoc).mockResolvedValue(snapshotFalso(makeOrder({ status: "pending" })) as never);

    await updateOrderStatus("orden-1", "processing");

    const [, cambios] = vi.mocked(updateDoc).mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];

    // Las reglas usan diff().affectedKeys().hasOnly(['status','updatedAt']):
    // mandar cualquier otro campo haría fallar la escritura entera.
    expect(Object.keys(cambios).sort()).toEqual(["status", "updatedAt"]);
    expect(cambios.status).toBe("processing");
    expect(cambios.updatedAt).toBe("MARCA_DE_TIEMPO_DEL_SERVIDOR");
  });

  it("rechaza una transición inválida sin llegar a escribir", async () => {
    vi.mocked(getDoc).mockResolvedValue(snapshotFalso(makeOrder({ status: "completed" })) as never);

    await expect(updateOrderStatus("orden-1", "pending")).rejects.toThrow(/no está permitido/i);

    expect(updateDoc).not.toHaveBeenCalled();
  });

  it("rechaza volver a un estado terminal desde otro terminal", async () => {
    vi.mocked(getDoc).mockResolvedValue(snapshotFalso(makeOrder({ status: "cancelled" })) as never);

    await expect(updateOrderStatus("orden-1", "completed")).rejects.toThrow(/no está permitido/i);

    expect(updateDoc).not.toHaveBeenCalled();
  });

  it("valida contra el estado REAL de la base, no contra el que le pasen", async () => {
    // La orden en la base ya está en "completed" aunque la pantalla del admin
    // todavía la muestre como "pending". Sin la lectura previa, el service
    // dejaría pasar la escritura y el rechazo llegaría como un error de
    // permisos genérico desde las reglas.
    vi.mocked(getDoc).mockResolvedValue(snapshotFalso(makeOrder({ status: "completed" })) as never);

    await expect(updateOrderStatus("orden-1", "cancelled")).rejects.toMatchObject({
      code: "INVALID_ORDER",
    });
  });

  it("falla con un mensaje claro si la orden ya no existe", async () => {
    vi.mocked(getDoc).mockResolvedValue(snapshotFalso(null) as never);

    await expect(updateOrderStatus("orden-borrada", "processing")).rejects.toThrow(/ya no existe/i);

    expect(updateDoc).not.toHaveBeenCalled();
  });
});

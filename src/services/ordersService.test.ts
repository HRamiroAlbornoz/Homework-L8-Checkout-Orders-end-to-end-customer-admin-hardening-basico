import { describe, it, expect, beforeEach, vi } from "vitest";
import { FirebaseError } from "firebase/app";
import { makeCartItem } from "@/test/fixtures";
import type { CartState } from "@/features/cart/types";

// Nunca se toca Firestore real: se mockean la conexión y las funciones del SDK
// que arman las referencias, para poder inspeccionar exactamente QUÉ documentos
// se escriben y con qué contenido.
//
// Eso es justamente lo que hay que verificar acá. La orden dejó de guardar sus
// totales y los ítems pasaron a una subcolección para que las reglas puedan
// comprobar cada precio contra el catálogo: si el service volviera a escribir un
// total, el agujero de seguridad se reabriría sin que ningún otro test lo note.
vi.mock("@/lib/firebase", () => ({ db: { __marca: "db" } }));

vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  serverTimestamp: vi.fn(() => "MARCA_DE_TIEMPO_DEL_SERVIDOR"),
  writeBatch: vi.fn(),
}));

import { collection, doc, writeBatch } from "firebase/firestore";
import { createOrderFromCart, ORDERS_COLLECTION, ORDER_ITEMS_SUBCOLLECTION } from "./ordersService";

// Formas mínimas que imitan lo que devuelven collection() y doc(). Solo llevan
// lo necesario para poder afirmar sobre ellas.
interface ColeccionFalsa {
  tipo: "coleccion";
  ruta: string;
  padre: unknown;
}

interface DocumentoFalso {
  tipo: "documento";
  id: string;
  coleccion: ColeccionFalsa;
}

const batchFalso = {
  set: vi.fn(),
  commit: vi.fn(),
};

const carritoConDosProductos: CartState = {
  items: [
    makeCartItem({ productId: "p-1", name: "Nike Air Max 90", unitPrice: 100, quantity: 2 }),
    makeCartItem({ productId: "p-2", name: "Adidas Gazelle", unitPrice: 50, quantity: 1 }),
  ],
  totalItems: 3,
  totalPrice: 250,
};

/** Devuelve las llamadas a batch.set() ya tipadas. */
function documentosEscritos(): Array<[DocumentoFalso, Record<string, unknown>]> {
  return batchFalso.set.mock.calls as Array<[DocumentoFalso, Record<string, unknown>]>;
}

beforeEach(() => {
  batchFalso.set.mockClear();
  batchFalso.commit.mockClear().mockResolvedValue(undefined);

  let contadorDeDocumentos = 0;

  // Los "as never" de acá abajo son inevitables: las firmas reales del SDK
  // devuelven clases del propio Firestore que no se pueden construir en un test.
  vi.mocked(collection).mockImplementation(
    (padre: unknown, ruta?: string) =>
      ({ tipo: "coleccion", ruta: ruta ?? ORDERS_COLLECTION, padre }) as never,
  );

  vi.mocked(doc).mockImplementation((coleccion: unknown) => {
    contadorDeDocumentos += 1;
    return {
      tipo: "documento",
      id: `documento-${contadorDeDocumentos}`,
      coleccion,
    } as never;
  });

  vi.mocked(writeBatch).mockReturnValue(batchFalso as never);
});

describe("createOrderFromCart — validaciones antes de tocar la red", () => {
  it("rechaza un carrito vacío con un mensaje entendible", async () => {
    await expect(
      createOrderFromCart("uid-1", { items: [], totalItems: 0, totalPrice: 0 }),
    ).rejects.toThrow(/carrito vacío/i);

    // No se abre ningún batch: el error se detecta antes, no se descubre por un
    // rechazo de Firestore que llegaría con un mensaje de permisos genérico.
    expect(writeBatch).not.toHaveBeenCalled();
  });

  it("rechaza una compra sin usuario", async () => {
    await expect(createOrderFromCart("", carritoConDosProductos)).rejects.toThrow(
      /iniciar sesión/i,
    );

    expect(writeBatch).not.toHaveBeenCalled();
  });
});

describe("createOrderFromCart — qué se escribe", () => {
  it("escribe la orden y un documento por ítem, todo en un solo batch", async () => {
    await createOrderFromCart("uid-1", carritoConDosProductos);

    // 1 orden + 2 ítems.
    expect(batchFalso.set).toHaveBeenCalledTimes(3);
    expect(batchFalso.commit).toHaveBeenCalledTimes(1);
  });

  it("la orden NO guarda totales ni ítems", async () => {
    await createOrderFromCart("uid-1", carritoConDosProductos);

    const [, documentoDeLaOrden] = documentosEscritos()[0]!;

    // El corazón de la corrección de seguridad: un total guardado sería un dato
    // que las reglas de Firestore no pueden verificar, y era exactamente el que
    // se podía falsear editando el localStorage.
    expect(documentoDeLaOrden).toEqual({
      userId: "uid-1",
      status: "created",
      createdAt: "MARCA_DE_TIEMPO_DEL_SERVIDOR",
    });
    expect(documentoDeLaOrden).not.toHaveProperty("totalPrice");
    expect(documentoDeLaOrden).not.toHaveProperty("totalItems");
    expect(documentoDeLaOrden).not.toHaveProperty("items");
  });

  it("el estado inicial siempre es 'created', no lo decide quien llama", async () => {
    await createOrderFromCart("uid-1", carritoConDosProductos);

    const [, documentoDeLaOrden] = documentosEscritos()[0]!;
    expect(documentoDeLaOrden.status).toBe("created");
  });

  it("la fecha la pone el servidor, no el reloj del navegador", async () => {
    await createOrderFromCart("uid-1", carritoConDosProductos);

    const [, documentoDeLaOrden] = documentosEscritos()[0]!;
    // Con new Date(), la fecha saldría del reloj del usuario: manipulable, y el
    // orden cronológico de las órdenes dejaría de ser confiable.
    expect(documentoDeLaOrden.createdAt).toBe("MARCA_DE_TIEMPO_DEL_SERVIDOR");
  });

  it("cada ítem va a la subcolección 'items' de esa orden", async () => {
    await createOrderFromCart("uid-1", carritoConDosProductos);

    const [referenciaDeLaOrden] = documentosEscritos()[0]!;
    const [referenciaDelPrimerItem] = documentosEscritos()[1]!;

    expect(referenciaDelPrimerItem.coleccion.ruta).toBe(ORDER_ITEMS_SUBCOLLECTION);
    // La subcolección cuelga del documento de la orden, no de la raíz.
    expect(referenciaDelPrimerItem.coleccion.padre).toBe(referenciaDeLaOrden);
  });

  it("cada ítem guarda la foto del producto y el userId del comprador", async () => {
    await createOrderFromCart("uid-1", carritoConDosProductos);

    const [, primerItem] = documentosEscritos()[1]!;
    const [, segundoItem] = documentosEscritos()[2]!;

    // El userId se repite en cada ítem a propósito: en un writeBatch las reglas
    // se evalúan contra el estado anterior al lote, así que una regla que
    // hiciera get() sobre la orden padre fallaría (todavía no existe).
    expect(primerItem).toEqual({
      userId: "uid-1",
      productId: "p-1",
      name: "Nike Air Max 90",
      unitPrice: 100,
      quantity: 2,
    });
    expect(segundoItem).toMatchObject({ productId: "p-2", unitPrice: 50, quantity: 1 });
  });

  it("devuelve el id de la orden, no el de ningún ítem", async () => {
    const idDevuelto = await createOrderFromCart("uid-1", carritoConDosProductos);

    const [referenciaDeLaOrden] = documentosEscritos()[0]!;
    expect(idDevuelto).toBe(referenciaDeLaOrden.id);
  });
});

describe("createOrderFromCart — errores", () => {
  it("traduce un rechazo de permisos a un mensaje que sugiere revisar el carrito", async () => {
    batchFalso.commit.mockRejectedValue(
      new FirebaseError("permission-denied", "Missing or insufficient permissions."),
    );

    // Con las reglas verificando el precio contra el catálogo, la causa más
    // frecuente de un rechazo acá es que el precio cambió mientras el producto
    // estaba en el carrito. Mandar al usuario a iniciar sesión de nuevo lo haría
    // dar vueltas sin resolver nada.
    await expect(createOrderFromCart("uid-1", carritoConDosProductos)).rejects.toThrow(
      /volvé al carrito/i,
    );
  });

  it("nunca deja pasar el mensaje crudo del SDK", async () => {
    batchFalso.commit.mockRejectedValue(
      new FirebaseError("permission-denied", "Missing or insufficient permissions."),
    );

    await expect(createOrderFromCart("uid-1", carritoConDosProductos)).rejects.not.toThrow(
      /insufficient permissions/i,
    );
  });

  it("marca como reintentable un fallo de red, y no un rechazo de permisos", async () => {
    batchFalso.commit.mockRejectedValue(new FirebaseError("unavailable", "Backend unavailable"));

    // "retryable" es lo que le permite a quien consume el error decidir si
    // ofrecer un botón de reintentar o no. Sin ese dato tendría que adivinar.
    await expect(createOrderFromCart("uid-1", carritoConDosProductos)).rejects.toMatchObject({
      retryable: true,
    });
  });
});

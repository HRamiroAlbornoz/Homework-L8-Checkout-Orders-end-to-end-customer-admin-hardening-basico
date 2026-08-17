import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// Nunca tocamos Firestore real: mockeamos tanto la conexión (lib/firebase)
// como las funciones del SDK que arman la query, para poder inspeccionar
// exactamente qué constraints arma listProducts en cada escenario.
vi.mock("../lib/firebase", () => ({ db: {} }));

vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  query: vi.fn((_ref: unknown, ...constraints: unknown[]) => ({ constraints })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ type: "where", field, op, value })),
  orderBy: vi.fn((field: string) => ({ type: "orderBy", field })),
  startAt: vi.fn((value: unknown) => ({ type: "startAt", value })),
  endAt: vi.fn((value: unknown) => ({ type: "endAt", value })),
  startAfter: vi.fn((cursor: unknown) => ({ type: "startAfter", cursor })),
  limit: vi.fn((n: number) => ({ type: "limit", n })),
  getDocs: vi.fn(),
  addDoc: vi.fn(),
}));

import { collection, query, getDocs, addDoc } from "firebase/firestore";
import { FirebaseError } from "firebase/app";
import { db } from "../lib/firebase";
import { listProducts, createProduct } from "./productsService";
import type { Product } from "../types/product";
import { MIN_SEARCH_CHARS } from "../constants/search";

// Doc "convertido": simula lo que devuelve doc.data() ya pasado por el
// FirestoreDataConverter (acá probamos la construcción de la query, no el
// converter en sí, así que devolvemos el Product ya armado directamente).
function fakeDoc(product: Product) {
  return { id: product.id, data: () => product };
}

// Lee los constraints con los que se llamó a query() la última vez.
function getLastQueryConstraints(): unknown[] {
  const lastCall = (query as Mock).mock.calls.at(-1) as [unknown, ...unknown[]] | undefined;
  return lastCall ? lastCall.slice(1) : [];
}

const sampleProduct: Product = {
  id: "1",
  name: "Nike Air",
  nameLower: "nike air",
  categoryId: "zapatillas",
  price: 100,
};

describe("productsService.listProducts", () => {
  const fakeConvertedRef = { __brand: "convertedRef" };
  const fakeCollectionRef = { withConverter: vi.fn(() => fakeConvertedRef) };

  beforeEach(() => {
    vi.clearAllMocks();
    (collection as Mock).mockReturnValue(fakeCollectionRef);
    (getDocs as Mock).mockResolvedValue({ docs: [] });
  });

  it("consulta la colección 'products' de la instancia db", async () => {
    await listProducts({ pageSize: 20 });

    expect(collection).toHaveBeenCalledWith(db, "products");
  });

  it("usa el converter del catálogo (withConverter) sobre la colección products", async () => {
    await listProducts({ pageSize: 20 });

    expect(fakeCollectionRef.withConverter).toHaveBeenCalledTimes(1);
  });

  it("arma la query sobre la referencia ya convertida, no sobre la colección cruda", async () => {
    await listProducts({ pageSize: 20 });

    const [refUsado] = (query as Mock).mock.calls.at(-1) as [unknown, ...unknown[]];
    expect(refUsado).toBe(fakeConvertedRef);
  });

  it("agrega el filtro where cuando hay categoryId", async () => {
    await listProducts({ categoryId: "zapatillas", pageSize: 20 });

    expect(getLastQueryConstraints()).toContainEqual({
      type: "where",
      field: "categoryId",
      op: "==",
      value: "zapatillas",
    });
  });

  it("no agrega where cuando no hay categoryId", async () => {
    await listProducts({ pageSize: 20 });

    const hasWhere = getLastQueryConstraints().some((c) => (c as { type?: string }).type === "where");
    expect(hasWhere).toBe(false);
  });

  it("arma el rango de prefijo con startAt/endAt cuando searchPrefix tiene 2+ caracteres, normalizado a minúsculas", async () => {
    await listProducts({ searchPrefix: "NI", pageSize: 20 });

    const constraints = getLastQueryConstraints();
    expect(constraints).toContainEqual({ type: "orderBy", field: "nameLower" });
    expect(constraints).toContainEqual({ type: "startAt", value: "ni" });
    expect(constraints).toContainEqual({ type: "endAt", value: "ni" });
  });

  it("respeta el limite exacto de MIN_SEARCH_CHARS: un prefijo con justo ese largo ya dispara la busqueda", async () => {
    const prefixEnElLimite = "n".repeat(MIN_SEARCH_CHARS);
    await listProducts({ searchPrefix: prefixEnElLimite, pageSize: 20 });

    const constraints = getLastQueryConstraints();
    expect(constraints).toContainEqual({ type: "startAt", value: prefixEnElLimite });
    expect(constraints).toContainEqual({ type: "endAt", value: prefixEnElLimite + "" });
  });

  it("trata un searchPrefix vacio igual que sin busqueda (ordena por nameLower, sin startAt/endAt)", async () => {
    await listProducts({ searchPrefix: "", pageSize: 20 });

    const constraints = getLastQueryConstraints();
    expect(constraints.some((c) => (c as { type?: string }).type === "startAt")).toBe(false);
    expect(constraints).toContainEqual({ type: "orderBy", field: "nameLower" });
  });

  it("combina categoryId y searchPrefix en la misma consulta (where + rango de prefijo a la vez)", async () => {
    await listProducts({ categoryId: "zapatillas", searchPrefix: "ni", pageSize: 20 });

    const constraints = getLastQueryConstraints();
    expect(constraints).toContainEqual({ type: "where", field: "categoryId", op: "==", value: "zapatillas" });
    expect(constraints).toContainEqual({ type: "startAt", value: "ni" });
    expect(constraints).toContainEqual({ type: "endAt", value: "ni" + "" });
  });

  it("ignora searchPrefix si tiene menos de 2 caracteres (pero igual ordena por nameLower)", async () => {
    await listProducts({ searchPrefix: "n", pageSize: 20 });

    const constraints = getLastQueryConstraints();
    expect(constraints.some((c) => (c as { type?: string }).type === "startAt")).toBe(false);
    expect(constraints.some((c) => (c as { type?: string }).type === "endAt")).toBe(false);
    expect(constraints).toContainEqual({ type: "orderBy", field: "nameLower" });
  });

  it("usa startAfter (no startAt) cuando se pasa un cursor de paginación", async () => {
    const cursor = fakeDoc(sampleProduct) as never;
    await listProducts({ pageSize: 20, cursor });

    const constraints = getLastQueryConstraints();
    expect(constraints).toContainEqual({ type: "startAfter", cursor });
    expect(constraints.some((c) => (c as { type?: string }).type === "startAt")).toBe(false);
  });

  it("sin cursor no agrega el constraint startAfter", async () => {
    await listProducts({ pageSize: 20 });

    const constraints = getLastQueryConstraints();
    expect(constraints.some((c) => (c as { type?: string }).type === "startAfter")).toBe(false);
  });

  it("incluye siempre el limit con pageSize", async () => {
    await listProducts({ pageSize: 20 });

    expect(getLastQueryConstraints()).toContainEqual({ type: "limit", n: 20 });
  });

  it("usa el pageSize exacto que recibe, no un valor fijo", async () => {
    await listProducts({ pageSize: 5 });

    expect(getLastQueryConstraints()).toContainEqual({ type: "limit", n: 5 });
  });

  it("invoca getDocs con exactamente el objeto que devolvio query()", async () => {
    await listProducts({ pageSize: 20 });

    const queryResult = (query as Mock).mock.results[0]?.value as unknown;
    expect(getDocs).toHaveBeenCalledWith(queryResult);
  });

  it("retorna items mapeados y lastDoc a partir del último doc del snapshot", async () => {
    const otherProduct: Product = { ...sampleProduct, id: "2", name: "Nike Zoom", nameLower: "nike zoom" };
    const docs = [fakeDoc(sampleProduct), fakeDoc(otherProduct)];
    (getDocs as Mock).mockResolvedValueOnce({ docs });

    const result = await listProducts({ pageSize: 20 });

    expect(result.items).toEqual([sampleProduct, otherProduct]);
    // Mismo objeto que el último elemento de "docs" (referencia), no un doc nuevo:
    // "data" es una función y toEqual no considera iguales dos funciones distintas.
    expect(result.lastDoc).toBe(docs.at(-1));
  });

  it("preserva el orden de los documentos tal como los devuelve el snapshot", async () => {
    const productoB: Product = { ...sampleProduct, id: "2", name: "Nike Zoom", nameLower: "nike zoom" };
    const productoC: Product = { ...sampleProduct, id: "3", name: "Adidas Run", nameLower: "adidas run" };
    const docs = [fakeDoc(productoC), fakeDoc(sampleProduct), fakeDoc(productoB)];
    (getDocs as Mock).mockResolvedValueOnce({ docs });

    const result = await listProducts({ pageSize: 20 });

    expect(result.items.map((p) => p.id)).toEqual(["3", "1", "2"]);
  });

  it("con un solo documento en el snapshot, lastDoc apunta a ese unico documento", async () => {
    const unicoDoc = fakeDoc(sampleProduct);
    (getDocs as Mock).mockResolvedValueOnce({ docs: [unicoDoc] });

    const result = await listProducts({ pageSize: 20 });

    expect(result.items).toEqual([sampleProduct]);
    expect(result.lastDoc).toBe(unicoDoc);
  });

  it("retorna lastDoc null cuando el snapshot viene vacío", async () => {
    (getDocs as Mock).mockResolvedValueOnce({ docs: [] });

    const result = await listProducts({ pageSize: 20 });

    expect(result.items).toEqual([]);
    expect(result.lastDoc).toBeNull();
  });

  it("propaga un Error legible si getDocs falla con un Error real", async () => {
    (getDocs as Mock).mockRejectedValueOnce(new Error("permission-denied"));

    await expect(listProducts({ pageSize: 20 })).rejects.toThrow("permission-denied");
  });

  it("envuelve en un Error genérico si falla con algo que no es un Error", async () => {
    (getDocs as Mock).mockRejectedValueOnce("fallo desconocido");

    await expect(listProducts({ pageSize: 20 })).rejects.toThrow("Error desconocido al consultar productos");
  });
});

describe("createProduct", () => {
  const productoValido = {
    name: "Nike Air Max 90",
    categoryId: "calzado",
    price: 75410,
    imageUrl: "https://bucket.s3.us-east-1.amazonaws.com/products/abc.png",
  };

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("deriva nameLower del nombre, en minúsculas", async () => {
    (addDoc as Mock).mockResolvedValue({ id: "producto-1" });

    await createProduct(productoValido);

    const [, documento] = (addDoc as Mock).mock.calls[0] as [unknown, Record<string, unknown>];
    // nameLower no se recibe como parámetro: lo deriva el service. Si viniera
    // del formulario, un descuido con las mayúsculas dejaría el producto
    // invisible en las búsquedas por prefijo.
    expect(documento.nameLower).toBe("nike air max 90");
    expect(documento.name).toBe("Nike Air Max 90");
  });

  it("devuelve el id del documento creado", async () => {
    (addDoc as Mock).mockResolvedValue({ id: "producto-1" });

    await expect(createProduct(productoValido)).resolves.toBe("producto-1");
  });

  it("ante un permiso denegado, avisa en español y NO expone el error del SDK", async () => {
    (addDoc as Mock).mockRejectedValue(
      new FirebaseError("permission-denied", "Missing or insufficient permissions."),
    );

    await expect(createProduct(productoValido)).rejects.toThrow(/no tenés permisos/i);
    // El mensaje del SDK está en inglés y no le dice a nadie qué hacer.
    await expect(createProduct(productoValido)).rejects.not.toThrow(/insufficient permissions/i);
  });

  it("ante cualquier otro fallo, devuelve un mensaje genérico entendible", async () => {
    (addDoc as Mock).mockRejectedValue(new FirebaseError("unavailable", "Backend unavailable"));

    await expect(createProduct(productoValido)).rejects.toThrow(/no pudimos crear el producto/i);
  });

  it("conserva el error original en 'cause' y lo registra, para poder diagnosticarlo", async () => {
    const errorOriginal = new FirebaseError("unavailable", "Backend unavailable");
    (addDoc as Mock).mockRejectedValue(errorOriginal);

    // El detalle técnico no se pierde: no llega a la pantalla, pero queda
    // disponible para quien tenga que investigar.
    await expect(createProduct(productoValido)).rejects.toMatchObject({ cause: errorOriginal });
    expect(console.error).toHaveBeenCalled();
  });
});

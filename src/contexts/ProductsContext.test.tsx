import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { ProductsProvider, useProducts } from "./ProductsContext";
import { listProducts } from "../services/productsService";
import type { Product } from "../types/product";

// No tocamos Firestore ni productsService real: mockeamos listProducts para
// controlar exactamente qué devuelve cada llamada y probar solo la orquestación
// de estado que hace el context.
vi.mock("../services/productsService", () => ({
  listProducts: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <ProductsProvider>{children}</ProductsProvider>;
}

const productA: Product = { id: "1", name: "Nike Air", nameLower: "nike air", categoryId: "zapatillas" };
const productB: Product = { id: "2", name: "Nike Zoom", nameLower: "nike zoom", categoryId: "zapatillas" };
const productC: Product = { id: "3", name: "Adidas Run", nameLower: "adidas run", categoryId: "zapatillas" };

// Cursor falso: solo nos importa que sea un valor "truthy" distinguible,
// nunca se usa como un QueryDocumentSnapshot real (listProducts está mockeado).
function fakeLastDoc(id: string) {
  return { id } as never;
}

describe("useProducts guard", () => {
  it("tira un error claro si se usa fuera de ProductsProvider", () => {
    // Evita que el error de React (boundary no capturado) ensucie la salida del test.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => renderHook(() => useProducts())).toThrow(
      "useProducts debe usarse dentro de un ProductsProvider",
    );

    consoleError.mockRestore();
  });
});

describe("ProductsContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("arranca con estado inicial: sin productos, loading en true (evita el flash de EmptyState), hasMore true", () => {
    const { result } = renderHook(() => useProducts(), { wrapper });

    expect(result.current.products).toEqual([]);
    expect(result.current.loading).toBe(true);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("loadFirstPage carga productos y prende hasMore cuando vuelven pageSize items", async () => {
    (listProducts as Mock).mockResolvedValueOnce({ items: [productA, productB], lastDoc: fakeLastDoc("2") });

    const { result } = renderHook(() => useProducts(), { wrapper });

    await act(async () => {
      await result.current.loadFirstPage({ pageSize: 2 });
    });

    expect(result.current.products).toEqual([productA, productB]);
    expect(result.current.loading).toBe(false);
    expect(result.current.hasMore).toBe(true);
  });

  it("apaga hasMore cuando vuelven menos items que pageSize", async () => {
    (listProducts as Mock).mockResolvedValueOnce({ items: [productA], lastDoc: fakeLastDoc("1") });

    const { result } = renderHook(() => useProducts(), { wrapper });

    await act(async () => {
      await result.current.loadFirstPage({ pageSize: 20 });
    });

    expect(result.current.hasMore).toBe(false);
  });

  it("con un resultado vacío en la primera página, products queda vacío y hasMore en false", async () => {
    (listProducts as Mock).mockResolvedValueOnce({ items: [], lastDoc: null });

    const { result } = renderHook(() => useProducts(), { wrapper });

    await act(async () => {
      await result.current.loadFirstPage({ pageSize: 20 });
    });

    expect(result.current.products).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("loadFirstPage llama a listProducts con los params exactos recibidos, sin agregar cursor", async () => {
    (listProducts as Mock).mockResolvedValueOnce({ items: [productA], lastDoc: fakeLastDoc("1") });

    const { result } = renderHook(() => useProducts(), { wrapper });

    await act(async () => {
      await result.current.loadFirstPage({ categoryId: "zapatillas", searchPrefix: "ni", pageSize: 5 });
    });

    expect(listProducts).toHaveBeenCalledWith({ categoryId: "zapatillas", searchPrefix: "ni", pageSize: 5 });
  });

  it("pone loading en true de inmediato al iniciar loadFirstPage, antes de que la respuesta resuelva", async () => {
    let resolveResponse!: (value: { items: Product[]; lastDoc: ReturnType<typeof fakeLastDoc> }) => void;
    const pendingResponse = new Promise<{ items: Product[]; lastDoc: ReturnType<typeof fakeLastDoc> }>((resolve) => {
      resolveResponse = resolve;
    });
    (listProducts as Mock).mockReturnValueOnce(pendingResponse);

    const { result } = renderHook(() => useProducts(), { wrapper });

    let call!: Promise<void>;
    act(() => {
      call = result.current.loadFirstPage({ pageSize: 20 });
    });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveResponse({ items: [productA], lastDoc: fakeLastDoc("1") });
      await call;
    });
  });

  it("limpia el error previo apenas arranca una nueva loadFirstPage, sin esperar la respuesta", async () => {
    (listProducts as Mock).mockRejectedValueOnce(new Error("permission-denied"));
    const { result } = renderHook(() => useProducts(), { wrapper });

    await act(async () => {
      await result.current.loadFirstPage({ pageSize: 20 });
    });
    expect(result.current.error).toBe("permission-denied");

    let resolveResponse!: (value: { items: Product[]; lastDoc: ReturnType<typeof fakeLastDoc> }) => void;
    const pendingResponse = new Promise<{ items: Product[]; lastDoc: ReturnType<typeof fakeLastDoc> }>((resolve) => {
      resolveResponse = resolve;
    });
    (listProducts as Mock).mockReturnValueOnce(pendingResponse);

    let call!: Promise<void>;
    act(() => {
      call = result.current.loadFirstPage({ pageSize: 20 });
    });

    expect(result.current.error).toBeNull();

    await act(async () => {
      resolveResponse({ items: [productA], lastDoc: fakeLastDoc("1") });
      await call;
    });
  });

  it("loadFirstPage resetea los productos previos al cambiar de filtro (no mezcla resultados)", async () => {
    (listProducts as Mock)
      .mockResolvedValueOnce({ items: [productA, productB], lastDoc: fakeLastDoc("2") })
      .mockResolvedValueOnce({ items: [productC], lastDoc: fakeLastDoc("3") });

    const { result } = renderHook(() => useProducts(), { wrapper });

    await act(async () => {
      await result.current.loadFirstPage({ categoryId: "zapatillas", pageSize: 2 });
    });
    expect(result.current.products).toEqual([productA, productB]);

    await act(async () => {
      await result.current.loadFirstPage({ categoryId: "otra", pageSize: 2 });
    });
    expect(result.current.products).toEqual([productC]);
  });

  it("loadMore concatena la nueva página sin duplicar por id", async () => {
    (listProducts as Mock)
      .mockResolvedValueOnce({ items: [productA, productB], lastDoc: fakeLastDoc("2") })
      .mockResolvedValueOnce({ items: [productB, productC], lastDoc: fakeLastDoc("3") });

    const { result } = renderHook(() => useProducts(), { wrapper });

    await act(async () => {
      await result.current.loadFirstPage({ pageSize: 2 });
    });
    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.products).toEqual([productA, productB, productC]);
  });

  it("loadMore reutiliza los params de la última loadFirstPage y agrega el cursor (lastDoc)", async () => {
    const lastDocDePrimeraPagina = fakeLastDoc("2");
    (listProducts as Mock)
      .mockResolvedValueOnce({ items: [productA, productB], lastDoc: lastDocDePrimeraPagina })
      .mockResolvedValueOnce({ items: [productC], lastDoc: fakeLastDoc("3") });

    const { result } = renderHook(() => useProducts(), { wrapper });

    await act(async () => {
      await result.current.loadFirstPage({ categoryId: "zapatillas", pageSize: 2 });
    });
    await act(async () => {
      await result.current.loadMore();
    });

    expect(listProducts).toHaveBeenNthCalledWith(2, {
      categoryId: "zapatillas",
      pageSize: 2,
      cursor: lastDocDePrimeraPagina,
    });
  });

  it("pone loadingMore en true de inmediato al iniciar loadMore, antes de que la respuesta resuelva", async () => {
    (listProducts as Mock).mockResolvedValueOnce({ items: [productA], lastDoc: fakeLastDoc("1") });
    const { result } = renderHook(() => useProducts(), { wrapper });

    await act(async () => {
      await result.current.loadFirstPage({ pageSize: 1 }); // 1 item === pageSize => hasMore=true
    });

    let resolveResponse!: (value: { items: Product[]; lastDoc: ReturnType<typeof fakeLastDoc> }) => void;
    const pendingResponse = new Promise<{ items: Product[]; lastDoc: ReturnType<typeof fakeLastDoc> }>((resolve) => {
      resolveResponse = resolve;
    });
    (listProducts as Mock).mockReturnValueOnce(pendingResponse);

    let call!: Promise<void>;
    act(() => {
      call = result.current.loadMore();
    });

    expect(result.current.loadingMore).toBe(true);

    await act(async () => {
      resolveResponse({ items: [productB], lastDoc: fakeLastDoc("2") });
      await call;
    });
  });

  it("loadMore no hace nada si hasMore ya está en false (guard clause)", async () => {
    (listProducts as Mock).mockResolvedValueOnce({ items: [productA], lastDoc: fakeLastDoc("1") });

    const { result } = renderHook(() => useProducts(), { wrapper });

    await act(async () => {
      await result.current.loadFirstPage({ pageSize: 20 }); // 1 item < pageSize => hasMore=false
    });

    (listProducts as Mock).mockClear();

    await act(async () => {
      await result.current.loadMore();
    });

    expect(listProducts).not.toHaveBeenCalled();
  });

  it("loadMore no hace nada si todavía no se llamó a loadFirstPage (sin lastDoc/params)", async () => {
    const { result } = renderHook(() => useProducts(), { wrapper });

    await act(async () => {
      await result.current.loadMore();
    });

    expect(listProducts).not.toHaveBeenCalled();
  });

  it("guarda un mensaje de error legible si loadFirstPage falla, y lo limpia al reintentar con éxito", async () => {
    (listProducts as Mock)
      .mockRejectedValueOnce(new Error("permission-denied"))
      .mockResolvedValueOnce({ items: [productA], lastDoc: fakeLastDoc("1") });

    const { result } = renderHook(() => useProducts(), { wrapper });

    await act(async () => {
      await result.current.loadFirstPage({ pageSize: 20 });
    });
    expect(result.current.error).toBe("permission-denied");
    expect(result.current.loading).toBe(false);

    await act(async () => {
      await result.current.loadFirstPage({ pageSize: 20 });
    });
    expect(result.current.error).toBeNull();
    expect(result.current.products).toEqual([productA]);
  });

  it("guarda el error si loadMore falla, sin perder los productos ya cargados", async () => {
    (listProducts as Mock)
      .mockResolvedValueOnce({ items: [productA], lastDoc: fakeLastDoc("1") })
      .mockRejectedValueOnce(new Error("network-error"));

    const { result } = renderHook(() => useProducts(), { wrapper });

    await act(async () => {
      await result.current.loadFirstPage({ pageSize: 1 }); // 1 item === pageSize => hasMore=true
    });
    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.error).toBe("network-error");
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.products).toEqual([productA]);
  });

  it("reset() limpia también un error previo", async () => {
    (listProducts as Mock).mockRejectedValueOnce(new Error("permission-denied"));
    const { result } = renderHook(() => useProducts(), { wrapper });

    await act(async () => {
      await result.current.loadFirstPage({ pageSize: 20 });
    });
    expect(result.current.error).toBe("permission-denied");

    act(() => {
      result.current.reset();
    });

    expect(result.current.error).toBeNull();
  });

  it("reset() vuelve el estado al inicial", async () => {
    (listProducts as Mock).mockResolvedValueOnce({ items: [productA], lastDoc: fakeLastDoc("1") });

    const { result } = renderHook(() => useProducts(), { wrapper });

    await act(async () => {
      await result.current.loadFirstPage({ pageSize: 20 });
    });
    act(() => {
      result.current.reset();
    });

    expect(result.current.products).toEqual([]);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.lastDoc).toBeNull();
  });

  it("descarta una respuesta vieja de loadFirstPage si resuelve después que un filtro más nuevo (anti-race-condition)", async () => {
    // Promesas controladas a mano para simular resolución fuera de orden:
    // la llamada VIEJA (categoría "zapatillas") resuelve DESPUÉS que la nueva.
    let resolveOld!: (value: { items: Product[]; lastDoc: ReturnType<typeof fakeLastDoc> }) => void;
    let resolveNew!: (value: { items: Product[]; lastDoc: ReturnType<typeof fakeLastDoc> }) => void;
    const oldResponse = new Promise<{ items: Product[]; lastDoc: ReturnType<typeof fakeLastDoc> }>((resolve) => {
      resolveOld = resolve;
    });
    const newResponse = new Promise<{ items: Product[]; lastDoc: ReturnType<typeof fakeLastDoc> }>((resolve) => {
      resolveNew = resolve;
    });
    (listProducts as Mock).mockReturnValueOnce(oldResponse).mockReturnValueOnce(newResponse);

    const { result } = renderHook(() => useProducts(), { wrapper });

    let oldCall!: Promise<void>;
    let newCall!: Promise<void>;
    act(() => {
      oldCall = result.current.loadFirstPage({ categoryId: "zapatillas", pageSize: 20 });
    });
    act(() => {
      newCall = result.current.loadFirstPage({ categoryId: "ropa", pageSize: 20 });
    });

    // La request NUEVA resuelve primero.
    await act(async () => {
      resolveNew({ items: [productC], lastDoc: fakeLastDoc("3") });
      await newCall;
    });
    // La request VIEJA resuelve después: no debe pisar el estado.
    await act(async () => {
      resolveOld({ items: [productA, productB], lastDoc: fakeLastDoc("2") });
      await oldCall;
    });

    expect(result.current.products).toEqual([productC]);
  });

  it("descarta una respuesta vieja de loadMore si se disparó un loadFirstPage mientras estaba en vuelo", async () => {
    (listProducts as Mock).mockResolvedValueOnce({ items: [productA], lastDoc: fakeLastDoc("1") });

    const { result } = renderHook(() => useProducts(), { wrapper });

    await act(async () => {
      await result.current.loadFirstPage({ pageSize: 1 }); // 1 item === pageSize => hasMore=true
    });

    let resolveLoadMore!: (value: { items: Product[]; lastDoc: ReturnType<typeof fakeLastDoc> }) => void;
    const loadMoreResponse = new Promise<{ items: Product[]; lastDoc: ReturnType<typeof fakeLastDoc> }>((resolve) => {
      resolveLoadMore = resolve;
    });
    (listProducts as Mock).mockReturnValueOnce(loadMoreResponse);

    let loadMoreCall!: Promise<void>;
    act(() => {
      loadMoreCall = result.current.loadMore(); // queda "en vuelo"
    });

    // Mientras loadMore sigue esperando, el usuario cambia de filtro.
    (listProducts as Mock).mockResolvedValueOnce({ items: [productC], lastDoc: fakeLastDoc("3") });
    await act(async () => {
      await result.current.loadFirstPage({ categoryId: "otra", pageSize: 20 });
    });

    // Recién ahora resuelve el loadMore viejo: no debe mezclarse con productC.
    await act(async () => {
      resolveLoadMore({ items: [productB], lastDoc: fakeLastDoc("2") });
      await loadMoreCall;
    });

    expect(result.current.products).toEqual([productC]);
  });
});

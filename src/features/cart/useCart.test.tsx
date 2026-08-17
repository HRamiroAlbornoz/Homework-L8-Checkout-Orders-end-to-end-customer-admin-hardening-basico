import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { makeCartItem, makeCartItemInput } from "@/test/fixtures";
import { createProvidersWrapper } from "@/test/renderWithProviders";
import { CART_STORAGE_KEY } from "./cartConstants";
import { saveCartState } from "./cartStorage";
import type { CartState } from "./types";
import { useCart } from "./useCart";

// Tests del hook useCart: la lógica del carrito tal como la ve un componente.
//
// A diferencia de los tests del reducer (función pura, sin React), acá se monta
// el CartProvider de verdad con renderHook. Eso permite verificar cosas que el
// reducer solo no puede: que el provider conecte bien las acciones, que el
// estado inicial se resuelva como corresponde y que el carrito se persista.
//
// Todas las aserciones son sobre resultados OBSERVABLES del hook (items,
// totalItems, totalPrice). Nunca sobre "se llamó a dispatch con tal objeto": eso
// sería testear cómo está construido por dentro, y haría que el test se rompa al
// refactorizar aunque el comportamiento siga siendo correcto.

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useCart — guard del provider", () => {
  it("lanza un error claro si se usa fuera de un CartProvider", () => {
    // React imprime el error por consola además de propagarlo. Se silencia para
    // que la salida de la suite no muestre un error que este test PROVOCA a
    // propósito y que además está verificando.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => renderHook(() => useCart())).toThrow(
      "useCart debe usarse dentro de un CartProvider",
    );

    consoleError.mockRestore();
  });
});

describe("useCart — estado inicial", () => {
  it("arranca con el carrito vacío si no hay nada guardado", () => {
    const { result } = renderHook(() => useCart(), {
      wrapper: createProvidersWrapper(),
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.totalItems).toBe(0);
    expect(result.current.totalPrice).toBe(0);
  });

  it("arranca con el carrito precargado que le pasa el test, sin simular clicks", () => {
    const preloadedCartState: CartState = {
      items: [makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 2 })],
      totalItems: 2,
      totalPrice: 200,
    };

    const { result } = renderHook(() => useCart(), {
      wrapper: createProvidersWrapper({ preloadedCartState }),
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.totalItems).toBe(2);
    expect(result.current.totalPrice).toBe(200);
  });

  it("recupera el carrito guardado en localStorage de una sesión anterior", () => {
    saveCartState({
      items: [makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 3 })],
      totalItems: 3,
      totalPrice: 300,
    });

    const { result } = renderHook(() => useCart(), {
      wrapper: createProvidersWrapper(),
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.totalItems).toBe(3);
    expect(result.current.totalPrice).toBe(300);
  });
});

describe("useCart — acciones", () => {
  it("addItem agrega un producto y actualiza los totales", () => {
    const { result } = renderHook(() => useCart(), {
      wrapper: createProvidersWrapper(),
    });

    // act() le avisa a React que adentro va a haber un cambio de estado, y
    // espera a que termine de procesarlo antes de seguir. Sin esto, la aserción
    // de abajo leería el estado viejo.
    act(() => {
      result.current.addItem(makeCartItemInput({ productId: "p-1", unitPrice: 100 }));
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.totalItems).toBe(1);
    expect(result.current.totalPrice).toBe(100);
  });

  it("addItem del mismo producto dos veces deja una sola fila con cantidad 2", () => {
    const { result } = renderHook(() => useCart(), {
      wrapper: createProvidersWrapper(),
    });
    const item = makeCartItemInput({ productId: "p-1", unitPrice: 100 });

    act(() => {
      result.current.addItem(item);
      result.current.addItem(item);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.quantity).toBe(2);
    expect(result.current.totalPrice).toBe(200);
  });

  it("updateQuantity cambia la cantidad y recalcula el total", () => {
    const { result } = renderHook(() => useCart(), {
      wrapper: createProvidersWrapper({
        preloadedCartState: {
          items: [makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 1 })],
          totalItems: 1,
          totalPrice: 100,
        },
      }),
    });

    act(() => {
      result.current.updateQuantity("p-1", 4);
    });

    expect(result.current.totalItems).toBe(4);
    expect(result.current.totalPrice).toBe(400);
  });

  it("updateQuantity a 0 saca el producto del carrito", () => {
    const { result } = renderHook(() => useCart(), {
      wrapper: createProvidersWrapper({
        preloadedCartState: {
          items: [makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 1 })],
          totalItems: 1,
          totalPrice: 100,
        },
      }),
    });

    act(() => {
      result.current.updateQuantity("p-1", 0);
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.totalPrice).toBe(0);
  });

  it("removeItem elimina solo el producto indicado", () => {
    const { result } = renderHook(() => useCart(), {
      wrapper: createProvidersWrapper({
        preloadedCartState: {
          items: [
            makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 1 }),
            makeCartItem({ productId: "p-2", name: "Adidas Gazelle", unitPrice: 50, quantity: 1 }),
          ],
          totalItems: 2,
          totalPrice: 150,
        },
      }),
    });

    act(() => {
      result.current.removeItem("p-1");
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.productId).toBe("p-2");
    expect(result.current.totalPrice).toBe(50);
  });

  it("clearCart deja el carrito vacío y los totales en 0", () => {
    const { result } = renderHook(() => useCart(), {
      wrapper: createProvidersWrapper({
        preloadedCartState: {
          items: [makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 2 })],
          totalItems: 2,
          totalPrice: 200,
        },
      }),
    });

    act(() => {
      result.current.clearCart();
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.totalItems).toBe(0);
    expect(result.current.totalPrice).toBe(0);
  });
});

describe("useCart — persistencia", () => {
  it("guarda el carrito en localStorage al agregar un producto", () => {
    const { result } = renderHook(() => useCart(), {
      wrapper: createProvidersWrapper(),
    });

    act(() => {
      result.current.addItem(makeCartItemInput({ productId: "p-1", unitPrice: 100 }));
    });

    const rawValue = window.localStorage.getItem(CART_STORAGE_KEY);
    expect(rawValue).not.toBeNull();
    expect(JSON.parse(rawValue ?? "")).toMatchObject({ totalItems: 1, totalPrice: 100 });
  });

  it("el carrito sobrevive a un remonte del provider (simula recargar la página)", () => {
    const first = renderHook(() => useCart(), { wrapper: createProvidersWrapper() });

    act(() => {
      first.result.current.addItem(makeCartItemInput({ productId: "p-1", unitPrice: 100 }));
    });
    first.unmount();

    // Provider nuevo, sin estado precargado: si el carrito reaparece, es porque
    // se leyó de localStorage y no porque quedó algo en memoria.
    const second = renderHook(() => useCart(), { wrapper: createProvidersWrapper() });

    expect(second.result.current.items).toHaveLength(1);
    expect(second.result.current.totalItems).toBe(1);
    expect(second.result.current.totalPrice).toBe(100);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeCartItem } from "@/test/fixtures";
import { CART_STORAGE_KEY } from "./cartConstants";
import { initialCartState } from "./cartReducer";
import { loadCartState, saveCartState } from "./cartStorage";
import type { CartState } from "./types";

// Tests de la capa de persistencia del carrito.
//
// A diferencia del reducer, acá sí hay una dependencia externa: localStorage.
// No hace falta mockearla en la mayoría de los casos porque jsdom trae una
// implementación real en memoria — es rápida y determinista, siempre que se
// limpie entre tests. Solo se mockea para simular fallos del navegador, que es
// lo único que no se puede reproducir de verdad.

beforeEach(() => {
  window.localStorage.clear();
  // El código avisa por consola cuando no puede leer o guardar. Se silencia acá
  // para que la salida de la suite quede limpia (los tests que lo necesitan
  // igual pueden verificar que se llamó), y porque un warning esperado en un
  // test no es información útil: es ruido.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  // Devuelve a console.warn (y a cualquier otro espía) su implementación real.
  // Sin esto, el espía quedaría puesto para los archivos de test siguientes.
  vi.restoreAllMocks();
});

describe("loadCartState", () => {
  it("devuelve un carrito vacío cuando no hay nada guardado (primera visita)", () => {
    const result = loadCartState();

    expect(result).toEqual(initialCartState);
  });

  it("recupera un carrito válido guardado previamente", () => {
    const storedCart: CartState = {
      items: [makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 2 })],
      totalItems: 2,
      totalPrice: 200,
    };
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(storedCart));

    const result = loadCartState();

    expect(result).toEqual(storedCart);
  });

  it("recalcula los totales si el JSON guardado tiene totales que no coinciden con los ítems", () => {
    // Escenario real: alguien edita el localStorage desde las devtools para
    // dejar 3 unidades de $100 con el total en 0. La FORMA del dato es válida
    // (0 es un número no negativo), así que Zod lo acepta; lo que está mal es la
    // coherencia entre los ítems y los totales.
    const tamperedCart = {
      items: [makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 3 })],
      totalItems: 0,
      totalPrice: 0,
    };
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(tamperedCart));

    const result = loadCartState();

    expect(result.totalItems).toBe(3);
    expect(result.totalPrice).toBe(300);
  });

  it("descarta y borra lo guardado si no cumple el schema (formato de otra versión)", () => {
    // Un ítem sin "name", sin "unitPrice" y sin "quantity": pasaría un
    // JSON.parse sin problema, pero no es un CartItem.
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({ items: [{ productId: "p-1" }] }),
    );

    const result = loadCartState();

    expect(result).toEqual(initialCartState);
    // La clave se borra para no reintentar leer (y fallar) en cada carga.
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
  });

  it("devuelve un carrito vacío si lo guardado no es JSON válido", () => {
    window.localStorage.setItem(CART_STORAGE_KEY, "esto no es json {{{");

    const result = loadCartState();

    expect(result).toEqual(initialCartState);
    expect(console.warn).toHaveBeenCalled();
  });

  it("devuelve un carrito vacío si el navegador bloquea el acceso a localStorage", () => {
    // Simula el modo privado de algunos navegadores, donde leer localStorage
    // lanza una excepción en vez de devolver null.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("El acceso a localStorage está bloqueado");
    });

    const result = loadCartState();

    expect(result).toEqual(initialCartState);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("saveCartState", () => {
  it("guarda el carrito serializado bajo la clave versionada", () => {
    const cart: CartState = {
      items: [makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 2 })],
      totalItems: 2,
      totalPrice: 200,
    };

    saveCartState(cart);

    const rawValue = window.localStorage.getItem(CART_STORAGE_KEY);
    expect(rawValue).not.toBeNull();
    expect(JSON.parse(rawValue ?? "")).toEqual(cart);
  });

  it("lo guardado se puede volver a leer con loadCartState (ida y vuelta completa)", () => {
    const cart: CartState = {
      items: [
        makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 2 }),
        makeCartItem({ productId: "p-2", name: "Adidas Gazelle", unitPrice: 50, quantity: 1 }),
      ],
      totalItems: 3,
      totalPrice: 250,
    };

    saveCartState(cart);

    expect(loadCartState()).toEqual(cart);
  });

  it("no lanza una excepción si el navegador rechaza la escritura (cuota llena)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    // La aserción es que NO explota: si guardar fallara con una excepción sin
    // atrapar, se rompería el render del componente que disparó el guardado.
    expect(() => saveCartState(initialCartState)).not.toThrow();
    expect(console.warn).toHaveBeenCalled();
  });
});

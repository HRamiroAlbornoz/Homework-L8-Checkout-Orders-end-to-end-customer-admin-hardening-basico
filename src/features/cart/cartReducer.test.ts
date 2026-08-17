import { describe, it, expect } from "vitest";
import { makeCartItem, makeCartItemInput, makeEmptyCartState } from "@/test/fixtures";
import { MAX_QUANTITY_PER_ITEM } from "./cartConstants";
import { cartReducer, initialCartState } from "./cartReducer";
import type { CartState } from "./types";

// Tests del reducer del carrito: la lógica crítica del e-commerce.
//
// No hay DOM, ni providers, ni mocks: el reducer es una función pura, así que
// alcanza con darle un estado y una acción y mirar qué devuelve. Eso los hace
// rápidos y, sobre todo, deterministas — no pueden fallar "a veces".
//
// Cada test sigue el patrón AAA: Arrange (armar el escenario), Act (ejecutar la
// acción) y Assert (verificar el resultado).
//
// Los totales esperados se escriben como números literales (300, 0.3) y no
// calculados con una fórmula. Si el test calculara el total esperado con la
// misma lógica que usa el reducer, un error en esa lógica estaría en los dos
// lados a la vez y el test pasaría sin detectar nada.

describe("cartReducer — ADD_ITEM", () => {
  it("agrega un producto nuevo a un carrito vacío con cantidad 1", () => {
    const state = makeEmptyCartState();
    const item = makeCartItemInput({ productId: "p-1", unitPrice: 100 });

    const result = cartReducer(state, { type: "ADD_ITEM", payload: { item } });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ productId: "p-1", quantity: 1 });
    expect(result.totalItems).toBe(1);
    expect(result.totalPrice).toBe(100);
  });

  it("agregar un producto que ya está en el carrito incrementa su cantidad en vez de duplicar la fila", () => {
    const state: CartState = {
      items: [makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 1 })],
      totalItems: 1,
      totalPrice: 100,
    };
    const item = makeCartItemInput({ productId: "p-1", unitPrice: 100 });

    const result = cartReducer(state, { type: "ADD_ITEM", payload: { item } });

    // La clave de este test: sigue habiendo UNA sola fila, con cantidad 2.
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.quantity).toBe(2);
    expect(result.totalItems).toBe(2);
    expect(result.totalPrice).toBe(200);
  });

  it("agregar un producto distinto suma una fila nueva y acumula los totales de ambos", () => {
    const state: CartState = {
      items: [makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 2 })],
      totalItems: 2,
      totalPrice: 200,
    };
    const item = makeCartItemInput({ productId: "p-2", name: "Adidas Gazelle", unitPrice: 50 });

    const result = cartReducer(state, { type: "ADD_ITEM", payload: { item } });

    expect(result.items).toHaveLength(2);
    expect(result.totalItems).toBe(3);
    expect(result.totalPrice).toBe(250);
  });

  it("no supera el máximo de unidades por producto aunque se agregue de nuevo", () => {
    const state: CartState = {
      items: [
        makeCartItem({ productId: "p-1", unitPrice: 100, quantity: MAX_QUANTITY_PER_ITEM }),
      ],
      totalItems: MAX_QUANTITY_PER_ITEM,
      totalPrice: 100 * MAX_QUANTITY_PER_ITEM,
    };
    const item = makeCartItemInput({ productId: "p-1", unitPrice: 100 });

    const result = cartReducer(state, { type: "ADD_ITEM", payload: { item } });

    expect(result.items[0]?.quantity).toBe(MAX_QUANTITY_PER_ITEM);
    expect(result.totalItems).toBe(MAX_QUANTITY_PER_ITEM);
  });

  it("redondea el total a 2 decimales (0.1 + 0.2 no debe dar 0.30000000000000004)", () => {
    const state: CartState = {
      items: [makeCartItem({ productId: "p-1", unitPrice: 0.1, quantity: 1 })],
      totalItems: 1,
      totalPrice: 0.1,
    };
    const item = makeCartItemInput({ productId: "p-2", unitPrice: 0.2 });

    const result = cartReducer(state, { type: "ADD_ITEM", payload: { item } });

    // Sin el redondeo explícito del reducer, esta aserción falla: la suma binaria
    // de 0.1 + 0.2 en JavaScript da 0.30000000000000004.
    expect(result.totalPrice).toBe(0.3);
  });
});

describe("cartReducer — UPDATE_QUANTITY", () => {
  it("cambia la cantidad de un producto y recalcula los totales", () => {
    const state: CartState = {
      items: [makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 1 })],
      totalItems: 1,
      totalPrice: 100,
    };

    const result = cartReducer(state, {
      type: "UPDATE_QUANTITY",
      payload: { productId: "p-1", quantity: 3 },
    });

    expect(result.items[0]?.quantity).toBe(3);
    expect(result.totalItems).toBe(3);
    expect(result.totalPrice).toBe(300);
  });

  it("con cantidad 0 elimina el producto del carrito", () => {
    const state: CartState = {
      items: [makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 1 })],
      totalItems: 1,
      totalPrice: 100,
    };

    const result = cartReducer(state, {
      type: "UPDATE_QUANTITY",
      payload: { productId: "p-1", quantity: 0 },
    });

    expect(result.items).toHaveLength(0);
    expect(result.totalItems).toBe(0);
    expect(result.totalPrice).toBe(0);
  });

  it("con cantidad negativa también elimina el producto, en vez de dejar un total negativo", () => {
    const state: CartState = {
      items: [makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 2 })],
      totalItems: 2,
      totalPrice: 200,
    };

    const result = cartReducer(state, {
      type: "UPDATE_QUANTITY",
      payload: { productId: "p-1", quantity: -5 },
    });

    expect(result.items).toHaveLength(0);
    expect(result.totalPrice).toBe(0);
  });

  it("descarta los decimales de la cantidad (2.7 unidades se guardan como 2)", () => {
    const state: CartState = {
      items: [makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 1 })],
      totalItems: 1,
      totalPrice: 100,
    };

    const result = cartReducer(state, {
      type: "UPDATE_QUANTITY",
      payload: { productId: "p-1", quantity: 2.7 },
    });

    expect(result.items[0]?.quantity).toBe(2);
    expect(result.totalPrice).toBe(200);
  });

  it("no supera el máximo de unidades por producto", () => {
    const state: CartState = {
      items: [makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 1 })],
      totalItems: 1,
      totalPrice: 100,
    };

    const result = cartReducer(state, {
      type: "UPDATE_QUANTITY",
      payload: { productId: "p-1", quantity: MAX_QUANTITY_PER_ITEM + 500 },
    });

    expect(result.items[0]?.quantity).toBe(MAX_QUANTITY_PER_ITEM);
  });

  it("deja el estado intacto si el producto no está en el carrito", () => {
    const state: CartState = {
      items: [makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 1 })],
      totalItems: 1,
      totalPrice: 100,
    };

    const result = cartReducer(state, {
      type: "UPDATE_QUANTITY",
      payload: { productId: "producto-que-no-existe", quantity: 5 },
    });

    // toBe compara por referencia: verifica que devuelve el MISMO objeto, no una
    // copia equivalente. Es lo que evita que React re-renderice sin motivo.
    expect(result).toBe(state);
  });
});

describe("cartReducer — REMOVE_ITEM", () => {
  it("elimina el producto indicado y deja los demás, recalculando los totales", () => {
    const state: CartState = {
      items: [
        makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 2 }),
        makeCartItem({ productId: "p-2", name: "Adidas Gazelle", unitPrice: 50, quantity: 1 }),
      ],
      totalItems: 3,
      totalPrice: 250,
    };

    const result = cartReducer(state, {
      type: "REMOVE_ITEM",
      payload: { productId: "p-1" },
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.productId).toBe("p-2");
    expect(result.totalItems).toBe(1);
    expect(result.totalPrice).toBe(50);
  });

  it("deja el estado intacto si el producto no está en el carrito", () => {
    const state: CartState = {
      items: [makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 1 })],
      totalItems: 1,
      totalPrice: 100,
    };

    const result = cartReducer(state, {
      type: "REMOVE_ITEM",
      payload: { productId: "producto-que-no-existe" },
    });

    expect(result).toBe(state);
  });
});

describe("cartReducer — CLEAR_CART", () => {
  it("vacía el carrito y pone los totales en 0", () => {
    const state: CartState = {
      items: [
        makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 2 }),
        makeCartItem({ productId: "p-2", unitPrice: 50, quantity: 1 }),
      ],
      totalItems: 3,
      totalPrice: 250,
    };

    const result = cartReducer(state, { type: "CLEAR_CART" });

    expect(result.items).toEqual([]);
    expect(result.totalItems).toBe(0);
    expect(result.totalPrice).toBe(0);
    expect(result).toEqual(initialCartState);
  });

  it("sobre un carrito ya vacío no rompe ni cambia nada", () => {
    const result = cartReducer(makeEmptyCartState(), { type: "CLEAR_CART" });

    expect(result).toEqual(initialCartState);
  });
});

describe("cartReducer — inmutabilidad", () => {
  it("no muta el estado recibido: el carrito original queda exactamente igual", () => {
    const originalItems = [makeCartItem({ productId: "p-1", unitPrice: 100, quantity: 1 })];
    const state: CartState = { items: originalItems, totalItems: 1, totalPrice: 100 };

    cartReducer(state, {
      type: "ADD_ITEM",
      payload: { item: makeCartItemInput({ productId: "p-2", unitPrice: 50 }) },
    });

    // Si el reducer hiciera push sobre el array recibido, este array tendría 2
    // elementos y los totales del estado original habrían quedado desfasados.
    // React compara por referencia: un reducer que muta no dispara re-render.
    expect(state.items).toBe(originalItems);
    expect(state.items).toHaveLength(1);
    expect(state.totalItems).toBe(1);
    expect(state.totalPrice).toBe(100);
  });
});

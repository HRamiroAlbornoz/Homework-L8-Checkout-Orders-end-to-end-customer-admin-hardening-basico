import type { CartItem, CartItemInput, CartState } from "@/features/cart/types";
import type { Product } from "@/types/product";

// Datos de prueba compartidos por toda la suite.
//
// Están armados como FUNCIONES (makeX) en vez de objetos sueltos exportados, por
// una razón concreta: un objeto exportado es una única instancia compartida entre
// todos los tests del archivo. Si un test lo modifica sin querer, contamina a los
// que corren después, y el fallo aparece en un test que no tiene nada que ver con
// la causa. Cada llamada a makeX() devuelve un objeto nuevo.
//
// El parámetro "overrides" permite pedir "lo de siempre, pero con este campo
// distinto" sin repetir los demás campos en cada test. Así el test resalta lo
// único que le importa (por ejemplo, un precio con decimales) y el ruido queda
// en el default.

const DEFAULT_PRODUCT: Product = {
  id: "p-1",
  name: "Nike Air Max 90",
  nameLower: "nike air max 90",
  categoryId: "calzado",
  price: 100,
};

export function makeProduct(overrides: Partial<Product> = {}): Product {
  return { ...DEFAULT_PRODUCT, ...overrides };
}

// Lo que se le pasa al carrito para agregar un producto: sin "quantity", porque
// esa la decide el reducer.
export function makeCartItemInput(
  overrides: Partial<CartItemInput> = {},
): CartItemInput {
  return {
    productId: "p-1",
    name: "Nike Air Max 90",
    unitPrice: 100,
    ...overrides,
  };
}

// Un ítem ya dentro del carrito (con cantidad).
export function makeCartItem(overrides: Partial<CartItem> = {}): CartItem {
  return { ...makeCartItemInput(), quantity: 1, ...overrides };
}

// Carrito vacío. A propósito NO existe un helper que arme un carrito con ítems
// calculando los totales: si las fixtures calcularan los totales con la misma
// lógica que el reducer, un error en esa lógica estaría en los dos lados a la
// vez y el test pasaría igual, sin detectar nada. Los tests que necesitan un
// carrito con ítems declaran los totales esperados como números literales.
export function makeEmptyCartState(): CartState {
  return { items: [], totalItems: 0, totalPrice: 0 };
}

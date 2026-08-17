import { CART_STORAGE_KEY } from "./cartConstants";
import { initialCartState, withRecalculatedTotals } from "./cartReducer";
import { cartStateSchema, type CartState } from "./types";

/**
 * Lee el carrito guardado en localStorage.
 *
 * Devuelve SIEMPRE un CartState válido: si lo guardado no existe, está corrupto,
 * tiene el formato de una versión anterior de la app, o localStorage no está
 * disponible, devuelve un carrito vacío en vez de fallar.
 *
 * Por qué se valida con Zod algo que escribió la propia app: porque entre que se
 * escribió y se lee pueden pasar muchas cosas. El usuario puede editarlo a mano
 * desde las devtools del navegador, puede haber quedado a medio escribir, o puede
 * ser de una versión anterior con otra forma. Confiar en que "lo escribimos
 * nosotros" es el error clásico con localStorage: el dato es externo igual que la
 * respuesta de una API.
 */
export function loadCartState(): CartState {
  try {
    const rawValue = window.localStorage.getItem(CART_STORAGE_KEY);

    // Todavía no hay nada guardado (primera visita): carrito vacío, sin drama.
    if (rawValue === null) {
      return initialCartState;
    }

    // JSON.parse devuelve "any" según su tipo oficial. Se anota como "unknown"
    // para que TypeScript obligue a validarlo antes de usarlo, en vez de dejar
    // que se cuele sin control.
    const parsedValue: unknown = JSON.parse(rawValue);
    const result = cartStateSchema.safeParse(parsedValue);

    // safeParse no lanza excepciones: devuelve { success: false, error } cuando
    // el dato no cumple la forma esperada. Eso permite manejar el caso como una
    // rama normal del código en vez de con un try/catch.
    if (!result.success) {
      // Se borra la clave para que el carrito roto no se vuelva a intentar leer
      // (y fallar) en cada carga de la página.
      window.localStorage.removeItem(CART_STORAGE_KEY);
      return initialCartState;
    }

    // Los ítems son la fuente de verdad; los totales del JSON se descartan y se
    // recalculan. Si alguien editó a mano el storage para dejar 3 zapatillas con
    // totalPrice: 0, acá se corrige solo.
    return withRecalculatedTotals(result.data.items);
  } catch (error) {
    // Entra acá si el JSON está mal formado, o si localStorage directamente no
    // está disponible (algunos navegadores lo bloquean en modo privado, o puede
    // estar lleno). No se propaga el error a propósito: que no se pueda leer un
    // carrito guardado no debe impedir que el usuario use la app. Pero tampoco se
    // silencia — queda registrado para poder diagnosticarlo.
    console.warn("No se pudo leer el carrito guardado. Se empieza con uno vacío.", error);
    return initialCartState;
  }
}

/**
 * Guarda el carrito en localStorage.
 *
 * Falla en silencio (con aviso en consola) por el mismo motivo que la lectura:
 * si el navegador bloquea el almacenamiento o se llenó la cuota, el usuario debe
 * poder seguir comprando. Perder la persistencia es molesto; romper el carrito
 * entero es mucho peor.
 */
export function saveCartState(state: CartState): void {
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("No se pudo guardar el carrito en el navegador.", error);
  }
}

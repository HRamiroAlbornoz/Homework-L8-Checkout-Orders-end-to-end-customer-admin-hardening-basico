import { z } from "zod";

// Un ítem del carrito guarda una FOTO del producto, no una referencia viva a él.
//
// Dos razones concretas:
//
// 1. En este proyecto "price" es opcional dentro de Product (ver types/product.ts),
//    porque un documento de Firestore puede no tenerlo. Pero un carrito sin precio
//    no puede calcular totales. Copiando el precio al agregar, el carrito trabaja
//    siempre con un número, y el caso "producto sin precio" se resuelve una sola
//    vez —antes de entrar al carrito— en vez de contaminar cada cálculo.
//
// 2. Si mañana cambia el precio del producto en Firestore, el carrito del usuario
//    no cambia solo mientras él lo está mirando. El precio que vio al agregar el
//    producto es el que va a pagar.
export const cartItemSchema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1),
  unitPrice: z.number().nonnegative(),
  quantity: z.number().int().positive(),
});

export type CartItem = z.infer<typeof cartItemSchema>;

// Lo que hace falta para agregar un producto al carrito: todo un CartItem menos
// la cantidad, porque la cantidad la decide el reducer (empieza en 1, y si el
// producto ya estaba, incrementa el que había). Se deriva con Omit en vez de
// escribir los tres campos otra vez: si mañana CartItem suma un campo, este tipo
// se entera solo.
export type CartItemInput = Omit<CartItem, "quantity">;

// El estado guarda los totales además de los ítems, en vez de recalcularlos en
// cada lectura. El riesgo conocido de esta decisión es que items y totales se
// desincronicen; se neutraliza haciendo que un único helper recalcule los
// totales al final de cada acción (ver cartReducer.ts).
//
// Este schema no está solo para tipar: el carrito se persiste en localStorage,
// y lo que se lee de ahí es un dato externo no confiable (puede estar corrupto,
// venir de una versión anterior de la app, o haber sido editado a mano desde las
// devtools del navegador). Se valida con safeParse al leerlo (ver cartStorage.ts).
export const cartStateSchema = z.object({
  items: z.array(cartItemSchema),
  totalItems: z.number().int().nonnegative(),
  totalPrice: z.number().nonnegative(),
});

export type CartState = z.infer<typeof cartStateSchema>;

// Acciones del carrito como unión discriminada: el campo "type" es el que
// discrimina, y TypeScript usa su valor para saber qué forma tiene "payload" en
// cada caso. Dentro de un case "REMOVE_ITEM", el compilador sabe que existe
// payload.productId y que NO existe payload.quantity — un error de tipeo se
// detecta al compilar, no en runtime.
//
// CLEAR_CART no lleva payload porque no necesita ningún dato: vaciar es vaciar.
export type CartAction =
  | { type: "ADD_ITEM"; payload: { item: CartItemInput } }
  | { type: "REMOVE_ITEM"; payload: { productId: string } }
  | { type: "UPDATE_QUANTITY"; payload: { productId: string; quantity: number } }
  | { type: "CLEAR_CART" };

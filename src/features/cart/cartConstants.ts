// Tope de unidades por producto. Existe para que un error de tipeo en el
// selector de cantidad (o un click sostenido en "+") no genere un carrito con
// 10.000 unidades y un total absurdo. El valor concreto es arbitrario; lo
// importante es que esté acá con nombre y no suelto como un 99 en medio del
// reducer, donde nadie sabría qué significa ni podría cambiarlo en un solo lugar.
export const MAX_QUANTITY_PER_ITEM = 99;

// Clave con la que se guarda el carrito en localStorage.
//
// El sufijo ":v1" es a propósito: si en el futuro cambia la forma de CartState
// (por ejemplo, si un ítem pasa a guardar también la imagen del producto), basta
// con subir a ":v2" para que los carritos viejos queden ignorados en vez de
// leerse mal. Sin versión, la app tendría que adivinar de qué formato es el JSON
// que encuentra guardado.
export const CART_STORAGE_KEY = "ecommerce:cart:v1";

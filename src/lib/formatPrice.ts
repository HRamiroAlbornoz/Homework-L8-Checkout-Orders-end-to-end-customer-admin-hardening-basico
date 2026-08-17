// El formateador se crea UNA sola vez a nivel de módulo, no dentro de la
// función. Construir un Intl.NumberFormat es una operación costosa (carga las
// reglas de formato del idioma), y en una grilla de 20 productos se estaría
// creando 20 veces por render sin ninguna necesidad.
const priceFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
});

/**
 * Formatea un monto como precio en pesos argentinos (ej: 1500 → "$ 1.500,00").
 *
 * Vive en un solo lugar para que el catálogo, el carrito y el checkout muestren
 * los precios exactamente igual. Si mañana cambia la moneda o el formato, se
 * cambia acá y se aplica en toda la app a la vez.
 */
export function formatPrice(amount: number): string {
  return priceFormatter.format(amount);
}

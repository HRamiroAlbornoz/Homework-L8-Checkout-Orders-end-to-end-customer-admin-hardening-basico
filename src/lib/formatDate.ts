// Mismo criterio que formatPrice: el formateador se crea UNA sola vez a nivel de
// módulo. Construir un Intl.DateTimeFormat carga las reglas de formato del
// idioma, y en un listado de 20 órdenes se estaría creando 20 veces por render.
const dateTimeFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "long",
  timeStyle: "short",
});

/**
 * Formatea una fecha con día y hora (ej: "15 de enero de 2026, 10:00").
 *
 * Se muestra también la hora, y no solo el día: si alguien compra dos veces el
 * mismo día, sin la hora las dos órdenes parecen simultáneas y el orden del
 * listado se vuelve inexplicable para quien lo mira.
 *
 * La zona horaria es la del navegador. El dato guardado en Firestore es un
 * instante absoluto (lo pone el servidor), así que cada persona lo ve en su
 * propia hora local, que es lo esperable en un historial de compras.
 */
export function formatDateTime(date: Date): string {
  return dateTimeFormatter.format(date);
}

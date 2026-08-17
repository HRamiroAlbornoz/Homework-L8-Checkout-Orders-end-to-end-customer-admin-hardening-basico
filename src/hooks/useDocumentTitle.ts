import { useEffect } from "react";

// Nombre del sitio, que va al final de todos los títulos.
//
// El orden importa: primero lo específico de la página, después el nombre del
// sitio. La pestaña de un navegador se angosta a medida que se abren más, y lo
// primero que se corta es el final del texto. Con "E-commerce Henry | Checkout"
// todas las pestañas se verían iguales; con "Checkout | E-commerce Henry" se
// distingue justo lo que cambia.
const SITE_NAME = "E-commerce Henry";

/**
 * Pone el título de la pestaña para la página actual.
 *
 * Por qué hace falta: esta es una SPA (single page application). El navegador
 * carga index.html UNA sola vez y a partir de ahí React reemplaza el contenido
 * sin recargar nada. El <title> del HTML queda como estaba, así que sin este
 * hook las siete pantallas comparten el título de la primera.
 *
 * Qué se rompe cuando no está:
 * - Con varias pestañas abiertas, todas se llaman igual y no se distinguen.
 * - El historial del navegador guarda entradas con el mismo nombre, así que
 *   "volver a la página del carrito" desde el historial es adivinar.
 * - Un lector de pantalla anuncia el título al cambiar de página: la persona
 *   escucha "Catálogo" al entrar al checkout.
 *
 * Va como hook y no como una tabla de rutas → títulos en el layout porque cada
 * página se declara a sí misma: no hay un segundo lugar que actualizar al
 * agregar una ruta, y un título que dependa de datos (el nombre de un producto,
 * por ejemplo) se resuelve igual, con la variable que la página ya tiene.
 *
 * @param title texto propio de la página, sin el nombre del sitio.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} | ${SITE_NAME}`;
    // El título NO se restaura al desmontar. Sería lo prolijo en un componente
    // reutilizable, pero acá cada página pone el suyo al montarse, así que lo
    // único que lograría es un parpadeo al valor viejo entre una pantalla y la
    // siguiente.
  }, [title]);
}

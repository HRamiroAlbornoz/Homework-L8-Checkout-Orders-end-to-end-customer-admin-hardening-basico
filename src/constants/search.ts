// Umbral mínimo de caracteres para disparar una búsqueda por prefijo. Compartido
// entre la UI (ProductsPage, para no mostrar "buscando..." de más) y el service
// (productsService, para no armar un rango de prefijo con un solo carácter),
// así el criterio de negocio no queda duplicado en dos capas distintas.
export const MIN_SEARCH_CHARS = 2;

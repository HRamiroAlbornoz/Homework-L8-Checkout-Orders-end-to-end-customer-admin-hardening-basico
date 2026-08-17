# Notas de uso de IA — Catálogo escalable

Este documento deja evidencia de cómo se usó IA (Claude) durante el desarrollo: los prompts obligatorios del enunciado, un resumen de las respuestas, y qué se aceptó/rechazó de cada una y por qué. También incluye decisiones de arquitectura que surgieron durante la implementación real (no solo de los prompts "oficiales"), porque fueron parte real del proceso de auditoría con IA.

---

## Prompt 1 — getDocs vs onSnapshot (arquitectura y costo)

**Prompt (copiado tal cual del enunciado):**
> Estoy implementando un catálogo de productos en React+TS con Firestore. Necesito filtros por categoría, búsqueda por prefijo y paginación con "Cargar más". ¿Por qué conviene usar getDocs en vez de onSnapshot para este caso? Considerá costo de lecturas, UX, y simplicidad. Respondé con pros/contras y una recomendación final.

**Resumen de la respuesta:**

| | `getDocs` (lectura puntual) | `onSnapshot` (listener en tiempo real) |
|---|---|---|
| Costo | Predecible: una lectura por consulta explícita | Menos predecible: cada escritura que matchea la query recalcula el snapshot y cuenta como lectura adicional |
| Paginación con cursor | Encaja naturalmente: cada "página" es una llamada puntual con `startAfter(lastDoc)` | Se complica: el listener se re-dispara solo con cambios en tiempo real, hay que gestionar múltiples suscripciones por página o acumular estado manualmente |
| UX | Suficiente para un catálogo de lectura — el usuario dispara la carga (filtro, búsqueda, "cargar más") | Da actualizaciones en vivo si otro usuario cambia datos, pero eso no es un requisito de este catálogo |
| Simplicidad | Menos código: no hay que gestionar `unsubscribe()` en cleanup de cada página | Requiere manejar la desuscripción correctamente en cada `useEffect` para evitar leaks |

**Recomendación final de la IA:** usar `getDocs` para este caso — el catálogo es de solo lectura, no necesita sincronización en tiempo real, y la combinación filtro+búsqueda+paginación por cursor es mucho más simple de razonar con lecturas puntuales. `onSnapshot` tendría sentido en una pantalla donde la actualización en vivo es parte del valor del producto (ej: un dashboard colaborativo o un carrito compartido), no en un catálogo de navegación.

**Decisión: ACEPTADO.** Todo el proyecto usa `getDocs` (`src/services/productsService.ts`). No se usó `onSnapshot` en ningún punto.

---

## Prompt 2 — Validación de query, cursores e índices

**Prompt (copiado tal cual del enunciado):**
> Estoy armando una query en Firestore para: where(categoryId == X) opcional, orderBy(nameLower), búsqueda por prefijo con startAt(prefix) y endAt(prefix + ''), y paginación con limit(20) + startAfter(lastDoc DocumentSnapshot). ¿Qué errores típicos puedo cometer (duplicados, índices faltantes, orderBy inconsistente)? ¿Qué índices podrían ser necesarios y cómo se resuelve "Missing index" correctamente?

**Resumen de la respuesta:**
- **Duplicados**: usar `startAt(cursor)` en vez de `startAfter(cursor)` para "cargar más" repite el último documento de la página anterior, porque `startAt` es inclusivo y `startAfter` es exclusivo.
- **`orderBy` inconsistente**: si la query "sin búsqueda" no ordena por el mismo campo que la query "con búsqueda" (`nameLower`), el cursor (`lastDoc`) deja de tener sentido entre una página y la siguiente — hay que ordenar siempre por `nameLower`, haya o no búsqueda activa.
- **Índices compuestos faltantes**: combinar `where('categoryId', '==', ...)` con `orderBy('nameLower')` (más el rango de prefijo) requiere un índice compuesto que Firestore no crea automáticamente. La consulta falla con un error `failed-precondition` que incluye un link directo a la consola para crearlo con un click; el índice tarda 1-2 minutos en construirse.
- **Cursor por snapshot vs por valores de campo**: `startAfter` acepta un `DocumentSnapshot` completo (más robusto) o una lista de valores de campo en el mismo orden que el `orderBy` — mezclar ambos enfoques entre páginas rompe la paginación.

**Decisión: ACEPTADO, con evidencia real.** Durante la verificación manual de este proyecto, justo se disparó el error real de "missing index" al combinar filtro de categoría + búsqueda por prefijo (que no se había probado en conjunto hasta ese momento). Se resolvió siguiendo exactamente el flujo que describe esta respuesta: Firestore mostró el link, se creó el índice desde la consola, y la consulta combinada funcionó sin más cambios de código. Esto confirma que la recomendación era correcta y no solo teórica.

---

## Prompt opcional — Code review del service/context

**Prompt (copiado tal cual del enunciado):**
> Te paso las firmas y responsabilidades: ProductsService.listProducts(params) devuelve items + lastDoc; ProductsContext tiene loadFirstPage/loadMore, separa loading y loadingMore, resetea al cambiar params y deduplica por id. ¿Qué mejorarías sin agregar librerías ni salirte del alcance?

**Resumen de la respuesta / sugerencias recibidas:**
1. Tipar el `FirestoreDataConverter` con **dos genéricos** (`<Product, ProductDoc>`) en vez de uno solo, para distinguir explícitamente el modelo de dominio del modelo crudo de Firestore (sin `id`).
2. Evitar deduplicar con `.filter()` + `.findIndex()` (O(n²)) y usar un `Map` indexado por `id` (O(n)) al combinar páginas.
3. Guardar los parámetros vigentes (filtro/búsqueda) en un `ref`, no en el estado, ya que `loadMore` los necesita pero no deberían disparar un re-render por sí solos.
4. No memoizar el `value` del context de entrada — priorizar código simple y correcto primero; memoizar solo si aparece un problema de performance medible.

**Decisiones:**
- **ACEPTADO (1)**: se implementó `FirestoreDataConverter<Product, ProductDoc>` con los dos genéricos en `productsService.ts`.
- **ACEPTADO (2)**: `mergeUniqueById` en `ProductsContext.tsx` usa `Map`, no `filter`/`findIndex`.
- **ACEPTADO (3)**: `currentParamsRef` es un `useRef`, no un `useState`.
- **ACEPTADO (4)**: el `value` del `ProductsProvider` no está memoizado a propósito; es una decisión consciente de simplicidad para el alcance de esta homework, documentada como código a revisar si en el futuro se detectan re-renders innecesarios.

---

## Otras decisiones tomadas durante el desarrollo (con auditoría de IA)

Estas no vinieron de los tres prompts de arriba, sino de decisiones de diseño e implementación que se discutieron y verificaron en el momento, con el mismo criterio de "aceptar o rechazar con justificación".

### Aceptadas

- **Estructura de carpetas plana** (`types/`, `services/`, `contexts/`, `hooks/`, `components/`, `pages/`) en vez del patrón `features/`. Justificación: el proyecto tiene un solo dominio (productos); `features/products/...` agregaría un nivel de anidación sin beneficio real a este alcance.
- **`useProducts()` vive en el mismo archivo que `ProductsProvider`** (no en un archivo aparte en `hooks/`), por simplicidad. Esto dispara la regla de lint `react-refresh/only-export-components` (afecta granularidad de Fast Refresh en desarrollo); se silenció puntualmente con un comentario explicando el motivo, en vez de desactivar la regla globalmente.
- **`toFirestore` del converter lanza un error explícito** en vez de intentar mapear campos: la interfaz `FirestoreDataConverter` exige implementarlo, pero este catálogo nunca escribe productos desde el frontend (es de solo lectura). Se descubrió durante la implementación que un intento de mapeo con destructuring no compilaba (la interfaz tiene dos firmas superpuestas para escrituras completas y parciales); en vez de forzar los tipos, se optó por la solución más simple y honesta.
- **`endAt(prefix + '')`** con el carácter Unicode de "fin de rango", tal como documenta Firebase oficialmente. Nota curiosa: ese carácter pertenece a un rango Unicode de uso privado y no tiene glifo visible, por lo que en el editor y en las herramientas de lectura de archivos aparece "vacío" — se verificó a nivel de bytes (codificación UTF-8 `EF A3 BF`) que el carácter correcto sí estaba presente antes de asumir que había un bug.
- **Script de seed con su propia inicialización de Firebase y su propia carga de variables de entorno** (no reutiliza `src/lib/firebase.ts` ni importa directamente `src/lib/env.ts`). Motivo técnico real: el script corre con Node bajo resolución de módulos `nodenext` (exige extensión `.js` en imports relativos), mientras que el resto de la app usa la resolución `bundler` de Vite (extensión opcional); además `env.ts` lee `import.meta.env`, que solo existe en el contexto de Vite, no en un script de Node plano. Se extrajo el schema de Zod a `src/lib/envSchema.ts` (sin efectos secundarios) para que ambos entornos lo reutilicen sin duplicar la lista de variables, y el script carga `.env` con `process.loadEnvFile()` (API nativa de Node) parseando contra `process.env`.
- **Categorías centralizadas en `src/constants/categories.ts`**, usadas tanto por `CategoryFilter` (UI) como por `scripts/seed.ts` (datos), para que nunca queden desincronizadas.
- **Reglas de Firestore abiertas (`allow read, write: if true`) sin fecha de expiración**, en vez del "modo de prueba" estándar (que expira solo). Aceptado únicamente porque este proyecto es una entrega educativa que no se va a desplegar públicamente ni subir a un repositorio compartido; si se reutilizara el proyecto Firebase para algo real, habría que volver a poner reglas con expiración o basadas en autenticación.

### Rechazadas (fuera de alcance, tal como pide el enunciado)

- **Full-text / fuzzy search / "contains"**: Firestore no lo soporta nativamente; se necesitaría un servicio externo (Algolia, Meilisearch, Typesense). Mencionado solo como alternativa conceptual, nunca implementado.
- **Paginación hacia atrás (`endBefore`/`limitToLast`)**: fuera del alcance del enunciado.
- **Infinite scroll**: se implementó con botón "Cargar más", tal como pide el enunciado.
- **Optimistic UI**: no aplica a un catálogo de solo lectura.
- **TanStack Query / Zustand**: Context API alcanza para un solo dominio de datos server-side con esta complejidad; se dejó como alternativa descartada, no como necesidad futura inmediata.
- **`onSnapshot`**: ver Prompt 1.

---

## Revisión de código con IA (post-implementación)

Una vez terminada la implementación (con todos los escenarios verificados manualmente en el navegador), se corrió una revisión de código asistida por IA sobre todo `src/` y `scripts/` — 8 agentes en paralelo cubriendo ángulos distintos (correctness línea por línea, comportamiento eliminado, rastreo cruzado entre archivos, reutilización, simplificación, eficiencia, "altitude"/profundidad de la solución, y cumplimiento de las reglas del CLAUDE.md), seguido de una verificación independiente de cada candidato antes de aceptarlo.

### Falso positivo notable (rechazado tras verificar)

Tres de los ocho agentes marcaron de forma independiente `endAt(prefix + '')` en `productsService.ts` como un bug ("falta el carácter, es un string vacío"). Se verificó con `charCodeAt` a nivel de bytes: el carácter Unicode `U+F8FF` está presente y es correcto — simplemente no tiene glifo visible en ningún editor o terminal (es un carácter del rango "uso privado" de Unicode), por lo que tanto humanos como IAs leyendo el archivo lo perciben como "vacío" sin estarlo. **Rechazado**: no se tocó ese código. Se documenta como advertencia para quien revise este archivo en el futuro (un profesor, otra herramienta) y se confunda con el mismo espejismo.

### Hallazgos confirmados y aceptados

1. **Race condition en `loadFirstPage`** (`ProductsContext.tsx`): si el usuario cambiaba de filtro antes de que resolviera la consulta anterior, y la respuesta vieja resolvía después que la nueva, pisaba el estado con datos que ya no correspondían al filtro visible — violaba el requisito explícito del enunciado de "no mezclar resultados" al cambiar filtros. **Aceptado**: se agregó un contador de "generación" (`requestIdRef`) que descarta respuestas que quedaron obsoletas.
2. **Mismo problema en `loadMore`**: una página pedida antes de cambiar de filtro podía mezclarse con los resultados del filtro nuevo y corromper el cursor de paginación. **Aceptado**: mismo mecanismo de generación aplicado.
3. **Flash de `EmptyState` antes de `LoadingState`**: `initialState.loading` arrancaba en `false`, así que había un instante (antes de que el `useEffect` disparara la primera carga) donde se pintaba "Todavía no hay productos" en vez del spinner, anunciado de más a lectores de pantalla por el `aria-live="polite"`. **Aceptado**: `initialState.loading` ahora arranca en `true`.
4. **Duplicación de la búsqueda `categoryId → label`** entre `ProductCard.tsx` y `ProductsPage.tsx`. **Aceptado**: se extrajo `getCategoryLabel()` a `constants/categories.ts`.
5. **Magic number duplicado** (`2`, el mínimo de caracteres de búsqueda) entre `ProductsPage.tsx` (ya lo tenía como constante) y `productsService.ts` (lo repetía crudo) — violación directa de la regla "no magic numbers" del CLAUDE.md. **Aceptado**: constante `MIN_SEARCH_CHARS` centralizada en `constants/search.ts`.
6. **Guard de `loadMore` vulnerable a doble-click**: leía `state.loadingMore`, que solo se actualiza en el próximo render de React, no al instante. Un doble click muy rápido podía disparar dos lecturas a Firestore para la misma página. **Aceptado**: reemplazado por un `useRef` que se lee/escribe sincrónicamente.

Se agregaron 2 tests de regresión nuevos en `ProductsContext.test.tsx` que simulan resolución de promesas fuera de orden — reproducen exactamente los escenarios de los hallazgos 1 y 2, y fallarían sin el fix aplicado.

---

# Notas de uso de IA — Homework L7 (Release Candidate)

Todo el trabajo de este homework se hizo en colaboración con Claude (Claude Code). Las intervenciones se registran abajo en el formato que pide el enunciado. Los "prompts" son los pedidos reales de la conversación, no reconstrucciones posteriores.

## Intervención 1 — Edge cases del `cartReducer`, priorizados por impacto

**Prompt**

> Vamos a hacer una Homework de Henry Boot Camp. [...] Analizá el enunciado y planificá.
>
> (Y más adelante, sobre el reducer:) escribí `cartReducer.test.ts`, los casos del Paso 3.

**Resumen de la respuesta**

Propuso 16 tests agrupados por acción, priorizados así:

1. **Consistencia de totales** — la falla de mayor impacto: mostrar "3 productos" con 2 en la lista.
2. **Deduplicación** — que agregar el mismo producto no cree dos filas.
3. **Cantidad 0 o negativa** — que elimine el ítem en vez de dejar un total negativo.
4. **Aritmética de punto flotante** — `0.1 + 0.2` da `0.30000000000000004`.
5. **Inmutabilidad** — que el reducer no mute el estado recibido.
6. **Tope máximo por producto** y **producto inexistente**.

**Qué acepté y por qué**

- **Todos los casos**, porque cada uno describe un fallo que el usuario notaría.
- Sobre todo, la propuesta de que **un único helper recalcule los totales** al final de cada acción. Eso convierte "acordarse de hacerlo bien cuatro veces" en "que no haya forma de hacerlo mal": ninguna acción arma el estado a mano.
- El caso de punto flotante, que sale directo de la regla del `CLAUDE.md` sobre montos monetarios.

**Qué rechacé y por qué**

- Un test de "acción desconocida devuelve el mismo estado". Con la unión discriminada completa, TypeScript ya garantiza que no existen otros valores de `type`, y escribirlo habría requerido un `as unknown as CartAction` — desactivar el chequeo para probar algo que el chequeo ya cubre.

**Evidencia**

Se verificó que los tests **detectan errores reales**, rompiendo el reducer a propósito:

| Qué se rompió | Qué reportaron los tests |
|---|---|
| Se quitó el redondeo a centavos | `expected 0.30000000000000004 to be 0.3` |
| Se forzó que siempre agregue una fila nueva | `expected [...] to have a length of 1 but got 2` |

Un test que pasa siempre no aporta información. Estos fallan cuando la lógica se rompe. Salida completa en [`docs/test-output.txt`](test-output.txt).

---

## Intervención 2 — Tests del flow con mocks (Opción A y Opción B)

**Prompt**

> Sabiendo que B es viable sin AWS pero exige construir también el CRUD de admin, ¿qué alcance elegís?
>
> → **A + B: todos los criterios PLUS**

**Resumen de la respuesta**

Para el checkout (Opción A): mockear la **capa de servicios** con `vi.mock`, cubriendo éxito, error y doble envío. Para el alta de producto (Opción B): **MSW** interceptando las dos requests (`POST /api/uploads/presign` y `PUT` a S3), verificando además el orden en que salen.

**Qué acepté y por qué**

- **Mockear el service y no el SDK de Firebase** en el checkout. Imitar `addDoc`, `collection` y `serverTimestamp` habría hecho que el test probara que sabemos usar Firebase, en vez de que la página reacciona bien según la operación salga bien o mal.
- **MSW para las llamadas HTTP.** Intercepta a nivel de red, así que el código llama a `fetch` de verdad con su URL, su método y su cuerpo reales. Un `vi.fn()` que devuelve un objeto no detectaría un cambio de endpoint.
- **`onUnhandledRequest: "error"`**: cualquier request sin handler rompe el test en lugar de salir a la red.
- **Subir la imagen ANTES de crear el producto.** Al revés, si la subida falla queda un producto en el catálogo apuntando a una imagen inexistente, visible para todos los clientes y sin forma automática de detectarlo. En este orden, lo peor que puede pasar es una imagen huérfana en el bucket: invisible y barata de limpiar.

**Qué rechacé y por qué**

- **La primera versión del test de doble envío.** Usaba `user.dblClick()` y **pasaba igual con la protección quitada**: `userEvent` espera a que React re-renderice entre un click y el siguiente, así que el segundo encuentra el botón ya deshabilitado. El test verificaba el atributo `disabled`, no la protección real. Se reescribió disparando los dos clicks dentro de un mismo `act()`, sin re-render en el medio.
- **Poner `AuthProvider` y `ProductsProvider` dentro de `renderWithProviders`**, como sugiere la plantilla del enunciado. En este repositorio, importar `ProductsProvider` arrastra `lib/env.ts`, que valida las variables de entorno **en el momento de importarse**: bastaría con importar el wrapper para que el CI reventara antes de correr un solo test. La decisión quedó documentada dentro del propio archivo.
- **Espiar `dispatch` como aserción principal**, que el enunciado marca explícitamente como anti-patrón. Todas las aserciones miran resultados observables (`items`, `totalItems`, `totalPrice`), así que sobreviven a un refactor del provider.

**Evidencia**

El test de doble envío, verificado en las dos direcciones:

| Estado del código | Resultado |
|---|---|
| Sin el cerrojo del `useRef` | `expected to be called 1 times, but got 2 times` |
| Con el cerrojo | Pasa |

Y el de MSW afirmando el orden de las requests:

```ts
expect(requestLog).toEqual([
  "POST /api/uploads/presign",
  "PUT /products/fake-uuid.png",
]);
```

---

## Intervención 3 — Checklist de deploy para Vercel + Vite + Functions

**Prompt**

> Continuemos con la Etapa B.
>
> (Y a lo largo del deploy: el diagnóstico de los errores de producción y el armado del checklist.)

**Resumen de la respuesta**

Separó el deploy en dos etapas verificables (primero la app con las variables públicas, después S3), propuso el grep de secretos sobre `dist/`, y armó [`production-checklist.md`](../production-checklist.md) ejecutando cada ítem en vez de marcarlo.

**Qué acepté y por qué**

- **Dividir el deploy en dos etapas.** Si algo falla en la primera, el problema está en la configuración base de Vercel; si falla en la segunda, en AWS. Mezclarlas convierte cualquier error en una búsqueda entre diez variables posibles.
- **Nombrar las variables `S3_*` y no `AWS_*`.** Las Vercel Functions corren sobre AWS Lambda, donde `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY` están reservadas por el runtime y serían pisadas.
- **El grep de secretos sobre `dist/` con contraprueba**: buscar también un valor que **sí** debe estar (el id del proyecto de Firebase) y encontrarlo. Sin eso, un "no encontré nada" no distingue entre "no hay secretos" y "el método no busca bien".
- **Sacar `@vercel/node`.** Lo habíamos instalado solo para dos definiciones de tipos, y traía 105 paquetes con **7 vulnerabilidades altas**. La firma estándar de la Web (`Request` a `Response`) no necesita esos tipos.

**Qué rechacé y por qué**

- **`npm audit fix --force`.** Proponía bajar `@vercel/node` de la versión 5 a la 3 y `firebase-admin` de la 14 a la 10. Eso no es arreglar: es retroceder años de versiones para tapar un aviso. La línea "which is a breaking change" en la salida de `npm audit` es una señal de alarma, no una recomendación.
- **Cargar el `FIREBASE_SERVICE_ACCOUNT_JSON` en Vercel.** Tras rediseñar la función para verificar el token con `jose`, dejó de hacer falta. Una credencial con acceso total al proyecto que deja de vivir en un servidor es una superficie de ataque menos.
- **Relajar temporalmente las reglas de Firestore** para poder correr el seed. Habría abierto una ventana en la que cualquiera podía escribir en el catálogo, y dejaba el repositorio y el proyecto desincronizados si el paso de restaurar fallaba. En su lugar se migró el seed al SDK de Admin.

**Evidencia**

```
=== ¿hay secretos en dist/? ===
  AKIA              -> 0 archivo(s)
  S3_SECRET         -> 0 archivo(s)
  SECRET_ACCESS_KEY -> 0 archivo(s)
  BEGIN PRIVATE KEY -> 0 archivo(s)
  service_account   -> 0 archivo(s)
  private_key       -> 0 archivo(s)
```

Y el flujo de subida verificado de punta a punta en producción, leído de la pestaña Network:

```
POST /api/uploads/presign        200
PUT  .../products/<uuid>.png     200   (a S3, con URL firmada)
POST .../Firestore/Write         200   (producto creado)
GET  .../products/<uuid>.png     200   (imagen pública)
```

---

## Intervención 4 — Recorrer todos los flujos y corregir lo que aparezca

**Prompt**

> ¿Puedes probar todos los flujos que tenga la app?
>
> (Y después: "Vamos a corregir ahora todos los hallazgos.")

**Resumen de la respuesta**

Manejó la aplicación entera —catálogo, carrito, auth, checkout, panel de admin, guards y 404— en producción, con al menos un intento de romper cada flujo. Encontró cinco defectos, y un sexto **al verificar la corrección de uno de los cinco**. El detalle completo está en la sección "Verificación de todos los flujos" de [`production-checklist.md`](../production-checklist.md).

Antes de escribir en producción preguntó hasta dónde avanzar, y resolvió la parte de credenciales sin pedirme ninguna: creó una cuenta con el propio formulario de registro y la usó para login, logout y checkout. Para el panel de admin solo hizo falta que yo cambiara el rol en la consola de Firebase.

**Qué acepté y por qué**

- **Probar las dos direcciones de cada defensa, no solo el ataque.** Verificar que un precio manipulado se rechaza es la mitad del trabajo; la otra mitad es que la compra legítima siga funcionando. Una regla que bloquea al atacante *y también* al cliente no es una corrección, es una caída de servicio.
- **`details.kind` en vez de un código de error por motivo.** El `code` es lo que el frontend usa para decidir qué hacer, y ante los siete rechazos hace exactamente lo mismo. Multiplicar códigos obliga al cliente a conocer una lista que crece con cada validación nueva.
- **`multipleOf(0.01)` en lugar de contar decimales a mano.** En punto flotante `0.1 + 0.2` no da `0.3`; un chequeo casero rechaza precios válidos en casos sueltos e impredecibles. Lo comprobó **antes** de escribir la corrección, no después.
- **El hook `useDocumentTitle` en vez de una tabla de rutas en el layout.** La tabla funciona, pero crea un segundo lugar que hay que acordarse de actualizar al sumar una ruta — y el día que alguien se olvide, la pantalla nueva hereda el título de otra: el mismo bug de hoy con otra causa.
- **Registrar en el checklist los escenarios que fallaron a propósito**, no solo los que pasaron. Un tilde sin el escenario al lado es una afirmación sin evidencia.

**Qué se descartó en el camino**

- **La primera corrección del panel de admin**, que centraba la tarjeta del formulario. Funcionaba y la medición lo confirmaba (310 px de margen a cada lado), pero dejaba el `<h1>` en un eje distinto. Se reemplazó por acotar la columna entera. La descartó la captura de pantalla, no un número.
- **Medir el reacomodo de las acciones del checkout redimensionando la ventana.** La ventana del navegador no baja de 500 px, y a ese ancho las dos acciones seguían entrando: la medición habría dado "correcto" sin haber ejercitado nada. Se reprodujo la condición apretando el contenedor a 260 px.
- **Verificar la Vercel Function con `vite dev`.** No existe ahí. Se subió la rama para que Vercel construyera un Preview y se atacó el endpoint realmente desplegado.

**Evidencia**

El caso que resume la ronda — el mismo campo, dos problemas opuestos, antes y después:

```
size: 6 MB  ->  kind: SIZE          "no puede pesar más de 5 MB"     (correcto)
size: 0     ->  kind: SIZE          "no puede pesar más de 5 MB"     (al revés)
size: 0     ->  kind: INVALID_SIZE  "está vacío o dañado"            (corregido)
```

Y la corrección del `<title>`, recorriendo las rutas sin recargar:

```
/                  Catálogo | E-commerce Henry
/cart              Carrito | E-commerce Henry
/checkout          Checkout | E-commerce Henry
/admin             Panel de administración | E-commerce Henry
/login             Iniciar sesión | E-commerce Henry
/signup            Crear cuenta | E-commerce Henry
(ruta inexistente) Página no encontrada | E-commerce Henry
```

---

## Lo que más aportó la IA en este homework

No fue escribir código: fue **insistir en verificar**.

Tres de los cuatro problemas registrados en las notas de debugging del checklist eran invisibles desde los tests, y los tres aparecieron por probar contra el despliegue real:

- Los 390 tests pasaban con la Vercel Function **completamente rota**, porque MSW intercepta la request y el código de la función nunca se ejecuta.
- El CI estaba en verde con producción sirviendo código viejo.
- El error que veía el usuario (`500 FUNCTION_INVOCATION_FAILED`) no decía nada: la causa real solo estaba en los logs de Vercel.

La conclusión que me llevo: **una suite en verde prueba lo que la suite mira.** Saber qué queda fuera de esa mirada es tan importante como la cobertura.

La ronda de la Intervención 4 le agregó un matiz que no esperaba. Los seis defectos que aparecieron ahí no estaban fuera del alcance de los tests por ser difíciles: estaban fuera porque **ningún test se le ocurriría preguntar eso**. Que el título de la pestaña sea distinto en cada pantalla, que un archivo vacío reciba el consejo correcto, que el título y la tarjeta compartan un eje. Son cosas que se notan usando la aplicación, no ejecutándola.

Y dos de los seis aparecieron **verificando la corrección de otro**. Eso reordena algo: la verificación no es el trámite del final, es donde sigue apareciendo trabajo. Cerrar un hallazgo sin volver a mirar la pantalla es cerrarlo a medias.

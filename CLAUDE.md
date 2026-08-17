# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # Servidor de desarrollo (Vite)
npm run build             # Type-check (tsc -b) + build de producción
npm run lint               # ESLint sobre todo el repo
npm run test                # Corre toda la suite de Vitest (modo run, no watch)
npx vitest run <path>        # Corre un solo archivo de test, ej: npx vitest run src/lib/authErrors.test.ts
npx vitest                    # Modo watch
npx tsc -b --noEmit           # Solo type-check, sin build
npm run seed                   # Carga productos de prueba en Firestore (scripts/seed.ts)
npm run seed -- --force         # Los agrega aunque la colección ya tenga documentos

firebase deploy --only firestore:rules,firestore:indexes   # Publica firestore.rules e índices
```

No hay un test runner por nombre de test individual configurado aparte del filtro por archivo de Vitest; para acotar más, usar `npx vitest run <path> -t "<nombre del test>"`.

Setup local: copiar `.env.example` a `.env` con las credenciales de un proyecto Firebase, y habilitar Email/Password en Firebase Console → Authentication → Sign-in method (paso manual, no hay código para esto). Las variables de entorno se validan al arrancar con Zod en `src/lib/envSchema.ts`.

El `.env.example` documenta las dos familias de variables y **por qué** están separadas. Las de `api/` (`S3_*`) solo hacen falta para el flujo de subida de imágenes; la app arranca sin ellas.

## Arquitectura

E-commerce React + TypeScript (strict) + Vite, con Firestore como base de datos y Firebase Authentication (SDK modular v9+, cliente) para email/password. Desplegado en Vercel, con una Vercel Function para firmar subidas a S3.

### `src/` y `api/` son dos mundos distintos

Todo lo que está en `src/` termina dentro del bundle que descarga el navegador: **cualquier persona puede leerlo**. `api/` solo corre en el servidor de Vercel y es lo único que puede tocar secretos.

Esa frontera es física, no una convención. Se sostiene con tres reglas:

- Las variables con prefijo `VITE_` son **públicas por definición**: Vite las reemplaza literalmente por su valor al construir el bundle. Los secretos no llevan ese prefijo y solo se leen con `process.env` dentro de `api/`.
- `api/` tiene su propio proyecto de TypeScript (`tsconfig.api.json`, referenciado desde `tsconfig.json`). Sin él, `tsc -b` ni miraría esa carpeta y los errores de tipos del código que maneja los secretos aparecerían recién en producción.
- Lo que ambos mundos comparten vive en módulos **sin dependencias** (`src/constants/uploads.ts`), importables desde los dos lados sin arrastrar nada.

`api/` corre como **ESM** (el `package.json` declara `"type": "module"`), así que sus imports relativos **necesitan la extensión `.js`** — la del archivo compilado. Vite completa extensiones y Node no; por eso este error solo se manifiesta en el despliegue.

### Capa de acceso a datos — nunca se salta

`components/`, `pages/` y `contexts/` **nunca** importan el SDK de Firebase/Firestore directamente. Todo el acceso a datos pasa por `src/services/` (`productsService.ts`, `usersService.ts`), que a su vez usan las instancias únicas `db`/`auth` exportadas desde `src/lib/firebase.ts`. Si cambia la fuente de datos, solo cambia esa capa.

### Sesión de usuario: una única fuente de verdad

`src/contexts/AuthContext.tsx` es la única fuente de verdad del estado de sesión (`user`, `loading`, `error`). El listener `onAuthStateChanged` es el **único** lugar que actualiza `user` — las funciones `login`/`signup`/`logout` que expone el contexto nunca lo tocan directamente, solo disparan la operación en Firebase y dejan que el listener reaccione. Esto evita que dos caminos escriban el mismo estado y se desincronicen.

`loading` empieza en `true` y se resuelve solo cuando `onAuthStateChanged` confirma el estado real. Por eso todo componente que decide algo en base a la sesión (`ProtectedRoute`, `AdminRoute`, `LoginPage`, `SignupPage`) **siempre chequea `loading` antes que `user`** — mientras `loading` es `true`, un `user: null` significa "todavía no se sabe", no "no hay sesión". El motivo completo, con un experimento reproducido a propósito, está documentado en `docs/auth-notes.md` sección 2.

`signup()` hace rollback (`deleteUser`) si falla después de crear la cuenta de Auth pero antes de terminar de escribir el perfil en Firestore, para no dejar cuentas huérfanas sin perfil y sin forma de reintentar el registro.

### Dos capas de protección independientes

- **Navegación**: `src/routes/ProtectedRoute.tsx` (requiere sesión) y `src/routes/AdminRoute.tsx` (requiere sesión + `role === "admin"`) son guards de React Router que redirigen (`Navigate replace`) antes de renderizar rutas hijas.
- **Datos**: `firestore.rules` (raíz del repo) es la que realmente importa contra un cliente malicioso — impide que un usuario se autoasigne el rol `admin`, tanto al crear su perfil como al actualizarlo, y valida los campos del documento al crearlo (`email`, `displayName`, `createdAt == request.time`).

Estas dos capas son independientes a propósito: los guards son UX, las reglas son seguridad real.

### Errores de auth: código + mensaje

`src/lib/authErrorCodes.ts` define `AUTH_ERROR_CODES` (`as const`, SCREAMING_SNAKE_CASE). `src/lib/authErrors.ts` expone `mapAuthError(error)`, que traduce cualquier error de Firebase Auth a una instancia de `AuthError extends Error` con `.code` + `.message` en español + `.cause` (el error original). Los mensajes de login nunca revelan si un email existe o no en la base — `user-not-found`/`wrong-password`/`invalid-credential` colapsan al mismo código `INVALID_CREDENTIALS` con el mismo mensaje genérico.

### Validación de formularios

`src/lib/authFormSchemas.ts` valida signup/login con Zod antes de llamar a Firebase: límites de longitud en todos los campos (email 254, displayName 100, password 128) y, solo en signup, contraseña mínimo 8 caracteres con letra + número. El schema usa `.pipe()` (`z.string().min().max().pipe(z.email())`) para que un email vacío muestre "es obligatorio" antes que "no es válido" — si se usa `z.email()` como raíz del schema, esa precedencia de mensajes se rompe.

### Carrito: reducer puro, provider con funciones nombradas

`src/features/cart/` agrupa todo el carrito. Tres decisiones que sostienen el diseño:

- **`cartReducer.ts` es una función pura**, separada del provider. No lee ni escribe nada de afuera, así que se testea sin DOM, sin providers y sin mocks.
- **Un único helper (`withRecalculatedTotals`) recalcula los totales** al final de cada acción. Ninguna acción arma el estado a mano, así que es imposible actualizar los ítems y olvidarse de los totales. `cartStorage.ts` usa el mismo helper al leer de `localStorage`, de modo que un JSON manipulado a mano se corrige solo.
- **`CartProvider` expone funciones nombradas** (`addItem`, `removeItem`…), nunca `dispatch` crudo. La API pública del feature es el hook `useCart`; el Context no debe importarse desde los componentes.

Un ítem del carrito guarda una **foto** del producto (`productId`, `name`, `unitPrice`), no una referencia viva. En este proyecto `price` es opcional dentro de `Product`, así que el problema "producto sin precio" se resuelve una sola vez, en la puerta de entrada (`AddToCartButton`), en vez de contaminar cada cálculo.

### Órdenes: un solo documento con los ítems adentro

```
orders/{orderId} → { userId, items[], total, status, createdAt, updatedAt? }
```

Cada ítem es una **foto** del producto (`productId`, `name`, `priceAtPurchase`, `quantity`). El historial **no** se rehidrata leyendo `products`: si el precio cambia o el producto se elimina, la orden tiene que seguir mostrando qué se compró y a cuánto.

**⚠ Este modelo reemplazó a uno más seguro, y hay que saberlo antes de tocarlo.**

Hasta el L7, cada ítem era un documento propio en `orders/{id}/items/{itemId}`, y no era una decisión organizativa sino de seguridad: las reglas **no pueden recorrer un array**, pero **sí pueden leer otros documentos con `get()`**. Con un documento por ítem, cada uno tenía su propia evaluación de regla y se podía comparar su precio contra el catálogo, lo que impedía comprar más barato editando `localStorage`.

El contrato del enunciado del L8 exige el modelo embebido, así que **esa verificación ya no es posible**. Las reglas validan forma, tipos, cantidad de ítems y rangos, pero no precios ni la suma del total.

Consecuencias que hay que conocer:

- **El total se recalcula en el service**, nunca se copia de `cart.totalPrice`. No cierra el agujero —los precios vienen del mismo lugar— pero evita guardar un total incoherente con las líneas de la propia orden. Hay un test que lo fuerza.
- **`priceAtPurchase`, no `unitPrice`.** El carrito conserva `unitPrice`; el mapeo ocurre en el service, porque el significado cambia: en el carrito es el precio de hoy, en la orden es el de esa compra.
- **Ya no se usa `writeBatch`.** Con un único documento, la escritura es atómica por definición.

**Para listar órdenes** hace falta incluir `where("userId", "==", uid)` si no sos admin. Firestore **no filtra los resultados** según las reglas: evalúa la regla contra cada documento devuelto y rechaza la consulta entera si alguno no cumple.

### Máquina de estados

`pending → processing → completed`, con `cancelled` alcanzable desde los dos primeros. `completed` y `cancelled` son **terminales**: ninguna transición se puede deshacer.

Está definida en `src/features/orders/orderTransitions.ts` y **replicada en `firestore.rules`**. La duplicación es deliberada —el `<select>` ayuda al usuario honesto, las reglas detienen al resto—, pero significa que **cambiar una obliga a cambiar la otra**. Ambos archivos lo señalan.

### El orden de las condiciones en `allow read` cuesta dinero

`isAdmin()` hace un `get()` sobre `users/{uid}`, y cada `get()` dentro de una regla es una **lectura facturable** que se cobra incluso cuando la regla rechaza. Las expresiones cortocircuitan, así que la comparación del dueño va **primero**: un cliente que lista sus órdenes no dispara ningún `get()`.

### Idempotencia del checkout

El `orderId` se genera con `createOrderId()` **antes** de escribir (`doc()` sobre una colección produce el id sin tocar la red) y se conserva en un `ref` mientras dura el intento, de modo que reintentar sobrescriba el mismo documento con `setDoc`. Con `addDoc` sería imposible: el id lo asigna la escritura.

**El caso borde que hay que respetar al tocar esto:** si el primer intento sí escribió y solo se perdió la respuesta, el reintento es un `update` a los ojos de las reglas — y el cliente no puede actualizar. Por eso, ante un `permission-denied`, el service comprueba si el documento ya existe y es del usuario antes de dar el error por bueno.

### Doble envío: el estado es lo que se ve, el ref es lo que decide

`CheckoutPage` y `CreateProductForm` protegen el envío con un `useRef` **además** del botón deshabilitado. Deshabilitar depende de que React vuelva a renderizar, y eso ocurre después de que termina el manejador: dos clicks muy rápidos pueden dispararse ambos antes. Un ref se actualiza en el acto.

El mismo patrón ya estaba en `ProductsContext` desde el Homework L4, por el mismo motivo.

### Subida de imágenes: el servidor firma, nunca ve los bytes

`api/uploads/presign.ts` devuelve una URL prefirmada de S3 y el navegador sube el archivo **directo al bucket**. La clave de AWS nunca sale del servidor.

Verifica en tres pasos, en este orden: identidad (401), permiso (403) y datos (400). El token se valida con `jose` contra las claves públicas de Google —comprobando también emisor y audiencia— y el rol se lee por la **API REST de Firestore con el token del propio usuario**, así que quien autoriza es `firestore.rules` y no un SDK con acceso total.

**No se usa `firebase-admin` acá**: depende de `jwks-rsa`, que es CommonJS y hace `require("jose")`; `jose` 6 es solo ESM y el runtime de Vercel no admite `require()` de ESM. `scripts/seed.ts` sí lo usa, porque corre en Node local.

El nombre del archivo se genera con `randomUUID()` y la extensión sale del `contentType` ya validado, nunca del nombre que manda el cliente. `signableHeaders: ["content-type"]` hace que S3 rechace el `PUT` si el navegador declara un tipo distinto al firmado.

### Árbol de la app

`main.tsx`: `BrowserRouter` → `AuthProvider` → `CartProvider` → `App`. `AuthProvider` envuelve todo *dentro* del router para que `useAuth()` esté disponible en cualquier ruta, incluido el `Header`. `CartProvider` va **debajo** de `AuthProvider`: la sesión es lo más transversal (hasta los guards dependen de ella) y el checkout necesita saber quién compra, mientras que la sesión nunca necesita el carrito.

`App.tsx` define las rutas sobre `RootLayout` (Header + `<Outlet />` compartidos); `ProductsProvider` envuelve solo la ruta `/` porque el catálogo de productos no lo necesita el resto de la app.

**`/cart` es pública a propósito**: un visitante arma su carrito antes de registrarse (vive en `localStorage`) y la sesión recién se exige al pagar. `/checkout`, `/orders` y `/orders/:orderId` están bajo `ProtectedRoute`.

**El panel de administración usa una ruta-layout.** `/admin` (productos) y `/admin/orders` cuelgan de un `<Route path="admin" element={<AdminLayout />}>` que a su vez está dentro de `AdminRoute`. El guard se declara **una sola vez**: cada sección nueva del panel lo hereda sin tener que acordarse de repetirlo, que es exactamente la forma en que un día una se olvida. `AdminLayout` aporta el `<h1>` y la navegación entre secciones, así que las páginas hijas empiezan en `<h2>`.

### El título de la pestaña lo pone cada página

Esta es una SPA: el navegador carga `index.html` **una sola vez** y React reemplaza el contenido sin recargar, así que el `<title>` del HTML nunca cambia por su cuenta. Una pantalla nueva que no llame a `useDocumentTitle("...")` **hereda el título de la anterior** — y nada avisa, porque no es un error, es simplemente el valor viejo.

La llamada va **arriba de todo en el componente, antes de cualquier `return` temprano**. `CartPage`, `LoginPage` y `SignupPage` tienen salidas anticipadas y son donde la regla de hooks es fácil de violar sin darse cuenta.

El hook agrega ` | E-commerce Henry` al final. Ese orden es deliberado: la pestaña se angosta cuando se abren varias y lo primero que se corta es el final del texto, así que lo específico va primero.

Va como hook y no como una tabla de rutas → títulos en `RootLayout` para que no exista un segundo lugar que actualizar al sumar una ruta. Un título que dependa de datos (el nombre de un producto) se resuelve igual, con la variable que la página ya tiene.

### Estados de carga en fetch

Todo componente que fetchea datos maneja `loading`/`error`/`success` explícitamente, reusando `src/components/states/` (`LoadingState`, `ErrorState`, `EmptyState`) en vez de reimplementarlos por pantalla.

### Infraestructura de tests

`src/test/` concentra lo compartido: `setup.ts` (matchers de jest-dom, limpieza del DOM y ciclo de vida de MSW), `fixtures.ts` y `renderWithProviders.tsx`.

Dos reglas que no son obvias y que ya causaron problemas:

- **El archivo de setup no debe importar código de la aplicación.** `setupFiles` corre antes que los tests, así que cualquier módulo que arrastre queda cargado e instanciado **antes** de que un test pueda mockearlo. Por eso `src/test/msw/handlers.ts` importa `PRESIGN_ENDPOINT` de `constants/` y no del service.
- **`renderWithProviders` compone solo `MemoryRouter` + `CartProvider`.** No incluye `AuthProvider` (se suscribe a Firebase real al montar) ni `ProductsProvider` (importarlo arrastra `lib/env.ts`, que valida las variables de entorno al cargarse y reventaría en el CI). Los tests que necesitan sesión usan `vi.mock` sobre `useAuth`.

MSW corre con `onUnhandledRequest: "error"`: cualquier request sin handler rompe el test en vez de salir a la red.

**Lo que los tests NO cubren**: el interior de `api/`. MSW intercepta la request y devuelve una respuesta falsa, así que el código de la Vercel Function nunca se ejecuta. Los tests verifican el contrato entre el frontend y el endpoint; el endpoint solo se valida con un smoke test contra el despliegue.

## Documentación de decisiones ya escrita

No repetir investigación ya resuelta — leer antes de tocar código relacionado:

- [`production-checklist.md`](production-checklist.md): checklist de producción **ejecutado**, con la verificación de secretos en el bundle, los smoke tests contra producción, la sección "Verificación de todos los flujos" (la ronda completa manejando la app, con los casos que se rompieron a propósito), el plan de rollback y **diez notas de debugging** de problemas reales. Las que más ahorran tiempo: imports ESM sin extensión, el conflicto `firebase-admin`/`jose`, un merge en verde con producción desactualizada, que las reglas **rechazan** las consultas en vez de filtrarlas, y una medición correcta que contestaba la pregunta equivocada.

- [`docs/auth-notes.md`](docs/auth-notes.md): tabla de códigos de error de Firebase incluidos/descartados, el experimento de comentar el chequeo de `loading` en `ProtectedRoute`, code review de seguridad, preguntas de reflexión del enunciado, el caso borde de usuario autenticado sin perfil en Firestore, y un bug real de sesión ya diagnosticado y corregido (`createdAt` sin resolver justo después del signup — requiere `serverTimestamps: "estimate"` al leer con `snapshot.data()`).
- [`docs/ai-notes.md`](docs/ai-notes.md): decisiones heredadas del Homework L4 sobre el catálogo (paginación, búsqueda por prefijo, por qué `getDocs` en vez de `onSnapshot`). **Advertencia**: `endAt()` en `productsService.ts` usa el carácter Unicode de fin de rango (rango de uso privado, sin glifo visible) — en cualquier editor o salida de terminal se ve como si el string terminara vacío, pero no lo está; verificar a nivel de bytes/`charCodeAt` antes de "corregirlo".

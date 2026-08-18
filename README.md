# Checkout + Orders end-to-end — Homework L8 (Henry, Módulo 5)

Flujo de compra completo multi-rol sobre React + TypeScript + Firebase: el carrito se convierte en una **orden persistida** en Firestore, el cliente consulta su historial y su detalle, y un administrador lista, filtra y cambia estados desde un panel — todo con RBAC real en las reglas de seguridad, no solo en la interfaz.

Construido sobre la base del proyecto anterior ([L7 — Release Candidate del E-commerce](https://github.com/HRamiroAlbornoz/Homework-L7-Release-Candidate-del-E-commerce)), que aporta la autenticación, el catálogo y el carrito.

| | |
|---|---|
| Tests | 531 en 28 archivos |
| Pruebas de reglas | 28 contra Firestore real ([resultado](docs/verificacion-reglas.txt)) |
| CI | Lint, type-check, tests y build en cada push y PR |
| Decisiones y uso de IA | [`docs/ai-notes.md`](docs/ai-notes.md) |

## Stack

- **React 19 + TypeScript (strict) + Vite** — con `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` y `erasableSyntaxOnly`
- **Firebase Auth** (SDK modular) — email/password
- **Firestore** — catálogo, perfiles y órdenes
- **react-router** v8 (paquete unificado, no `react-router-dom`)
- **Zod** — variables de entorno, documentos de Firestore, formularios y `localStorage`
- **Vitest + Testing Library + MSW** — tests

## El modelo `Order`

```jsonc
{
  "userId": "uid_ABC123",
  "items": [
    { "productId": "prod_01", "name": "Adidas Gazelle", "priceAtPurchase": 26000, "quantity": 2 }
  ],
  "total": 52000,
  "status": "pending",          // pending | processing | completed | cancelled
  "createdAt": "Timestamp(server)",
  "updatedAt": "Timestamp(server)"  // solo tras el primer cambio de estado
}
```

**Cada ítem es una foto del producto al momento de comprarlo**, no una referencia viva. Por eso el campo se llama `priceAtPurchase` y no `price`: si el producto sube de precio o se elimina del catálogo, la orden tiene que seguir mostrando qué se compró y a cuánto. El historial **nunca** se rehidrata leyendo `products` — hacerlo reescribiría el pasado en silencio.

### Transiciones de estado

```
pending ──────► processing ──────► completed   (terminal)
   │                  │
   └──────────────────┴──────────► cancelled   (terminal)
```

Definidas una sola vez en [`orderTransitions.ts`](src/features/orders/orderTransitions.ts) y **replicadas en las reglas**. La duplicación es deliberada: deshabilitar una opción en el `<select>` ayuda al usuario honesto, pero no detiene a nadie que llame al SDK desde la consola del navegador.

### El precio se verifica contra el catálogo, en el servidor

Las reglas de Firestore **no pueden recorrer un array** —no hay bucles ni `map`/`reduce`—, pero **sí pueden acceder a una posición concreta** con notación de corchetes, que es lo que la [documentación oficial](https://firebase.google.com/docs/firestore/security/rules-fields) recomienda para validar listas.

`firestore.rules` desenrolla esa comprobación de la posición 0 a la 9:

```
items[i].priceAtPurchase == precioDeCatalogo(items[i].productId)
```

Cada ítem se contrasta contra `products/{productId}`, y el `total` contra la suma de las líneas. **Manipular el `localStorage` para comprar más barato no funciona**, y tampoco inventar un producto o declarar un total que no corresponde.

> **De dónde sale el tope de 10 ítems.** Firestore permite un máximo de **10 llamadas a `get()` por request de un solo documento**, y cada ítem consume una. No es una preferencia de diseño: es el techo de la plataforma. Por eso `MAX_ITEMS_PER_ORDER = 10` y por eso no se puede agregar ningún `get()` más a la regla de creación —ni siquiera un `isAdmin()`— sin bajar antes el tope.

Esto **recupera** la protección que tenía el proyecto anterior con una subcolección, sin abandonar el modelo `items[]` embebido que exige el contrato. La primera versión de esta rama la había dado por perdida; una revisión de seguridad mostró que no era una limitación aceptable sino un agujero explotable. La historia completa está en [`docs/ai-notes.md`](docs/ai-notes.md).

**Efecto secundario aceptado:** si un administrador cambia el precio de un producto, los carritos que ya lo tenían dejan de poder confirmarse. Es el costo de verificar contra el catálogo, y el checkout lo maneja con un mensaje de error.

**Lo que sigue sin poder verificarse:** la comparación del total lleva una tolerancia de un centavo, porque el cliente redondea cada línea a dos decimales y las reglas no tienen función de redondeo. No habilita ningún abuso —cada precio ya está verificado— y el motivo completo está en [Limitaciones conocidas](#limitaciones-conocidas).

## Qué incluye

**Checkout idempotente** — el `orderId` se genera **antes** de escribir y se reutiliza en los reintentos, así que insistir tras un error sobrescribe el mismo documento en lugar de crear órdenes duplicadas. Doble cerrojo contra el doble clic: `disabled` para lo que el usuario ve, y un `useRef` para lo que el código decide (el atributo `disabled` depende de un re-render que todavía no ocurrió).

**Historial y detalle del cliente** — con los tres estados (`loading` / `error` / `empty`) resueltos por componentes compartidos, y el snapshot de la compra tal como quedó guardado.

**Panel de administración** — listado global, filtro por estado resuelto **en Firestore** (no en memoria), y cambio de estado con confirmación que nombra la orden y los dos estados involucrados. Solo se ofrecen las transiciones válidas.

**Errores diferenciados** — `{ code, message, retryable }` con códigos propios para índice faltante, permisos, red y desconocido. Un índice faltante se marca como **no reintentable**: tarda un par de minutos en construirse, así que reintentar de inmediato produciría el mismo error en bucle.

**Sin conexión, el checkout avisa en vez de colgarse** — y esto merece una explicación, porque contradice lo que uno esperaría.

`setDoc()` **no rechaza** cuando no hay red: Firestore encola la escritura localmente y deja la promesa pendiente hasta que la conexión vuelva. Verificado en el navegador: sin nada que lo maneje, el botón se queda en *"Confirmando compra..."* **indefinidamente** —se probaron 45 segundos— sin error, sin salida y sin ninguna señal.

Como consecuencia, el código `NETWORK_ERROR` con `retryable: true` **casi nunca se dispara en un corte de red real**: está pensado para fallos que el servidor sí rechaza.

A los 8 segundos sin respuesta aparece un aviso —`role="status"`, no `alert`, porque la compra sigue en curso y probablemente termine bien— que explica qué pasa y advierte **no cerrar ni recargar la pestaña**. Esa advertencia no es un formalismo: el proyecto usa la caché **en memoria** de Firestore, así que la escritura encolada se pierde si la pestaña se cierra.

## Setup local

1. **Instalar dependencias**

   ```bash
   npm install
   ```

2. **Crear un proyecto de Firebase** — [consola](https://console.firebase.google.com):
   - Habilitar **Authentication → Email/contraseña**.
   - Crear **Firestore** en modo producción (las reglas reales se despliegan en el paso 5).
   - Registrar una app web y copiar el objeto `firebaseConfig`.

3. **Configurar las variables de entorno**

   ```bash
   cp .env.example .env
   ```

   Completar las 6 variables `VITE_FIREBASE_*` con los valores del paso anterior. Para el seed hace falta además `FIREBASE_SERVICE_ACCOUNT_JSON` **en una sola línea** (ver instrucciones dentro de `.env.example`).

   > Las variables `S3_*` son herencia del L7 y **no hacen falta acá**: sostienen la subida de imágenes del alta de productos, que está fuera del alcance de esta homework. La app arranca sin ellas.

4. **Vincular el CLI**

   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use --add
   ```

5. **Desplegar reglas e índices** — hay que hacerlo **antes** de crear usuarios: en modo producción, las reglas por defecto deniegan todo, incluida la creación del perfil al registrarse.

   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```

6. **Cargar el catálogo**

   ```bash
   npm run seed
   ```

7. **Levantar la app y crear los usuarios**

   ```bash
   npm run dev
   ```

   Registrar dos cuentas desde `/signup`. Ambas nacen con `role: "customer"`, forzado por las reglas. Para el panel de administración, cambiar `role` a `"admin"` desde Firestore Console → colección `users`. **Ese ascenso solo puede hacerse desde la consola**: las reglas prohíben que un usuario modifique su propio rol.

   Después de cambiarlo hay que **cerrar sesión y volver a entrar**: el perfil se lee al iniciar sesión.

## Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Type-check (`tsc -b`) + build de producción |
| `npm run test` | Suite completa de Vitest |
| `npm run lint` | ESLint sobre todo el repositorio |
| `npm run seed` | Carga productos de prueba (no hace nada si ya hay datos) |
| `npm run verify:rules` | Ejecuta las 28 pruebas de las reglas contra Firestore real |

## Rutas

| Ruta | Acceso | Página |
|---|---|---|
| `/` | Público | Catálogo |
| `/login`, `/signup` | Público (redirige si ya hay sesión) | Autenticación |
| `/cart` | **Público** | Carrito |
| `/checkout` | Requiere sesión | Checkout |
| `/orders` | Requiere sesión | Historial del cliente |
| `/orders/:orderId` | Requiere sesión | Detalle de una orden |
| `/admin` | Requiere `role === "admin"` | Alta de productos |
| `/admin/orders` | Requiere `role === "admin"` | Gestión de órdenes |

`/admin` y `/admin/orders` viven bajo una **ruta-layout** que declara el guard **una sola vez**. Cada sección nueva del panel lo hereda sin tener que acordarse — que es exactamente la forma en que un día una se olvida.

Cada página declara su propio título con `useDocumentTitle`. Es obligatorio en una pantalla nueva: el navegador carga `index.html` una sola vez, así que sin esa línea la pantalla hereda el título de la anterior.

## Reglas de seguridad

```
create   cliente autenticado, solo a su nombre, siempre en 'pending',
         con createdAt == request.time, sin campos de más,
         y con CADA ÍTEM verificado contra el precio del catálogo
read     el dueño, o cualquier administrador
update   solo administradores, solo 'status' y 'updatedAt',
         y solo si la transición es válida
delete   nunca
```

**El orden de las condiciones de `read` no es casual.** `isAdmin()` hace un `get()` sobre `users/{uid}`, y cada `get()` dentro de una regla es una **lectura facturable** que se cobra incluso cuando la regla rechaza. Como las expresiones cortocircuitan, la comparación del `userId` va primero: así un cliente que lista sus 20 órdenes no dispara ningún `get()`.

**El update usa `diff().affectedKeys().hasOnly()`**, que son los campos *efectivamente modificados*. Con `request.resource.data.keys()` habría que listar todos los campos del documento y no se estaría restringiendo nada.

### Cómo verificarlas

```bash
npm run verify:rules
```

Cubre los tres casos obligatorios del enunciado —un cliente no puede leer una orden ajena, un administrador sí puede cambiar el estado, y no puede tocar ningún otro campo— y veinticinco más: precios inventados, totales que no cuadran, productos inexistentes, campos de más, fechas falseadas y transiciones inválidas.

Crea dos órdenes de prueba y **las borra al terminar** con el SDK de Admin, dentro de un `finally`: las reglas prohíben el `delete` desde el cliente, así que sin esa limpieza cada corrida ensuciaría el historial real de forma permanente.

**Usa el SDK cliente y no el de Admin**, y esa es la decisión que sostiene todo el ejercicio: el SDK de Admin se saltea las reglas por diseño, así que con él las 23 pruebas pasarían sin comprobar nada.

## Testing

```bash
npm run test              # toda la suite
npx vitest                # modo watch
npx vitest run <archivo>  # un archivo puntual
```

**Los tests no usan red real.** Firebase se mockea con `vi.mock` y las requests HTTP las intercepta MSW con `onUnhandledRequest: "error"`, así que cualquier request sin handler rompe el test en lugar de salir a internet. La suite pasa sin archivo `.env` y sin conexión.

Una excepción deliberada: `orderConverter.test.ts` **no** mockea `firebase/firestore`, porque lo que prueba es la conversión desde la clase `Timestamp` real. Con un doble, el test comprobaría que el doble funciona.

## Seguridad

- **Roles** — un usuario no puede modificar su propio `role`. Lo impide `firestore.rules`, no el frontend.
- **Dos capas independientes** — `ProtectedRoute` / `AdminRoute` son UX; las reglas son la protección real contra un cliente malicioso.
- **Fechas del servidor** — `createdAt` y `updatedAt` se escriben con `serverTimestamp()` y las reglas lo **exigen** (`== request.time`). Con el reloj del navegador, el orden cronológico del historial sería manipulable.
- **Las órdenes no se borran** — deshacer una compra es una transición a `cancelled`, que deja rastro, no una eliminación que lo borra.
- **Precio de las órdenes** — cada línea se compara contra el precio del catálogo dentro de las reglas, y el total contra la suma de las líneas. Manipular el `localStorage` para comprar más barato no funciona.
- **Mensajes que no filtran información** — pedir una orden inexistente y pedir una ajena dan el **mismo** error. Distinguirlos permitiría probar ids al azar para averiguar cuáles corresponden a órdenes reales.


## Verificación manual de los flujos

Además de la suite automatizada, se recorrió la aplicación entera en el navegador con Chrome DevTools: guards de navegación, registro y login, catálogo con búsqueda y paginación, carrito, checkout, historial, detalle, panel de administración, alta de productos, teclado y foco, tema claro, 320px de ancho y consola.

Esa ronda encontró **tres cosas que los tests no veían**, y el patrón vale la pena: los tests verifican lo que a uno se le ocurrió verificar; el navegador muestra lo que no.

1. **El checkout se colgaba para siempre sin conexión** (explicado más arriba). Ningún test lo detectaba porque todos mockean el service, y un mock que nunca resuelve no era un caso que se hubiera pensado.
2. **Dos encabezados `h2` hermanos** en el panel de administración diciendo casi lo mismo, que ensuciaban la navegación por encabezados de un lector de pantalla.
3. **El botón "−" del carrito eliminaba el producto** al pulsarlo con una sola unidad, sin avisar — mientras que vaciar el carrito sí pedía confirmación. Dos acciones destructivas con criterios opuestos.

También apareció un **falso positivo instructivo**: `documentElement.scrollWidth` daba 751 en un viewport de 320, aparentando scroll horizontal. Intentar scrollear de verdad dejó `scrollX` en 0 — el contenedor de la tabla contenía el desborde correctamente. La métrica mentía; la prueba real, no.

## Limitaciones conocidas

- **Un máximo de 10 productos distintos por orden.** Es el techo de `get()` de las reglas, no una decisión de producto. Un carrito con más de 10 líneas no se puede confirmar; el checkout lo detecta antes y lo explica. Subirlo exigiría mover la creación de órdenes a un camino de servidor.
- **Los listados omiten los documentos que no superan la validación**, en vez de romperse. Con las reglas actuales no debería existir ninguno, pero la defensa se mantiene: si alguna vez se relajaran, un solo documento inválido dejaría el historial y el panel inutilizables de forma permanente, porque las órdenes tampoco se pueden borrar. La lectura de *una* orden puntual sigue siendo estricta y falla de forma visible: ahí un `null` se leería como "no existe" y ocultaría el problema.
- **6 vulnerabilidades `moderate` sin resolver**, todas con la misma raíz: `uuid < 11.1.1`, que llega de forma transitiva a través de `firebase-admin`. Es una **devDependency** usada solo por `npm run seed`, así que nunca entra al bundle. No se aplica `npm audit fix --force` porque **degradaría** `firebase-admin` de `^14.2.0` a `10.3.0` — cuatro versiones mayores hacia atrás, con sus propios agujeros sin parchear, para tapar uno que no es alcanzable desde este código.
- **Sin paginación en el panel de administración.** Con muchas órdenes, el listado global las trae todas. Fuera del alcance de esta homework.
- **La compra encolada sin conexión se pierde al cerrar la pestaña.** Firestore usa caché **en memoria** (`getFirestore(app)` sin persistencia), así que una escritura que quedó esperando red no sobrevive a cerrar o recargar. Por eso el aviso de demora lo dice explícitamente en vez de prometer que se registrará igual. Activar `persistentLocalCache` lo resolvería, a cambio de una decisión que hay que tomar a conciencia: los datos del usuario quedarían escritos en IndexedDB, lo que en una computadora compartida es una consideración de privacidad, no solo técnica.
- **El dinero se guarda como decimal, no como entero en centavos.** Es la decisión que un sistema de pagos serio tomaría al revés, y conviene saber por qué quedó así.

  Los números decimales no se pueden representar exactamente en binario: `10.55` se guarda como `10.550000000000000711`. El cliente redondea cada línea antes de sumar (para que el total coincida con lo que muestra en pantalla) y el lenguaje de las reglas **no tiene función de redondeo**, así que con una comparación exacta ambos lados divergen. Medido sobre 200.000 órdenes simuladas con precios de dos decimales, **el 24,6% sería rechazado** por diferencias del orden de `1e-13`. De ahí la tolerancia de un centavo en `firestore.rules`, que es la solución estándar y no habilita ningún abuso: cada precio ya está verificado contra el catálogo.

  Hoy el problema **no está activo** —el catálogo usa precios enteros— pero es latente: basta cargar un producto con centavos desde el panel. El arreglo de fondo es guardar los importes como enteros en centavos (`$ 10,55` → `1055`), que es lo que hacen Stripe y MercadoPago.

  No se hizo porque **la representación del dinero es una decisión de schema**: barata el primer día, cara después. Tocaría 29 archivos de producción y 270 aserciones de test, y sobre todo exigiría **reescribir órdenes ya guardadas** — registros históricos que las reglas protegen a propósito, y que son justamente lo que el diseño de snapshot existe para no tocar. En un sistema real se migraría con un campo nuevo conviviendo con el viejo, no con una conversión.

## Deploy

**Reglas e índices no se despliegan con la app:**

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

Los índices tardan 1–2 minutos en construirse. Mientras tanto, las consultas que los necesitan fallan con `FAILED_PRECONDITION` — la app lo muestra como un mensaje de configuración, no como un error del usuario.

Están versionados en `firestore.indexes.json` a propósito: un índice creado a mano desde el link del error vive **solo en ese proyecto**, y producción fallaría con una consulta que en desarrollo funciona.

## Documentación

- [`docs/ai-notes.md`](docs/ai-notes.md) — los cuatro prompts obligatorios, qué se aceptó y qué se rechazó, y una sección sobre **dónde la IA se equivocó**.
- [`docs/verificacion-reglas.txt`](docs/verificacion-reglas.txt) — salida de las 23 pruebas de reglas.
- [`docs/evidencias/`](docs/evidencias/) — capturas del flujo completo.
- [`docs/auth-notes.md`](docs/auth-notes.md) — códigos de error de Firebase y el caso borde del usuario sin perfil (heredado del L7).
- [`production-checklist.md`](production-checklist.md) — checklist de producción del L7.
- [`CLAUDE.md`](CLAUDE.md) — guía de arquitectura del repositorio.

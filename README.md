# Checkout + Orders end-to-end — Homework L8 (Henry, Módulo 5)

Flujo de compra completo multi-rol sobre React + TypeScript + Firebase: el carrito se convierte en una **orden persistida** en Firestore, el cliente consulta su historial y su detalle, y un administrador lista, filtra y cambia estados desde un panel — todo con RBAC real en las reglas de seguridad, no solo en la interfaz.

Construido sobre la base del proyecto anterior ([L7 — Release Candidate del E-commerce](https://github.com/HRamiroAlbornoz/Homework-L7-Release-Candidate-del-E-commerce)), que aporta la autenticación, el catálogo y el carrito.

| | |
|---|---|
| Tests | 519 en 28 archivos |
| Pruebas de reglas | 23 contra Firestore real ([resultado](docs/verificacion-reglas.txt)) |
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

### ⚠ Lo que las reglas no pueden verificar

El lenguaje de las reglas de Firestore **no permite recorrer un array**. Con los ítems embebidos en el documento —que es lo que exige el contrato del enunciado— no hay forma de comprobar la forma de cada ítem, ni contrastar su precio contra el catálogo, ni verificar que `total` sea la suma de las líneas.

El proyecto anterior guardaba cada ítem como un documento propio en una subcolección justamente para poder verificar el precio con un `get()`. Ese modelo cerraba un agujero que este reabre. **Es un trade-off consciente**, no un descuido, y está documentado en [`docs/ai-notes.md`](docs/ai-notes.md#el-punto-donde-se-rechazó-el-contrato-del-enunciado-y-se-aceptó-igual).

Mitigación parcial: el service **recalcula** el total a partir de los ítems en vez de copiar el del carrito. No cierra el agujero, pero evita guardar un total que no se corresponde con las líneas de la propia orden.

## Qué incluye

**Checkout idempotente** — el `orderId` se genera **antes** de escribir y se reutiliza en los reintentos, así que insistir tras un error sobrescribe el mismo documento en lugar de crear órdenes duplicadas. Doble cerrojo contra el doble clic: `disabled` para lo que el usuario ve, y un `useRef` para lo que el código decide (el atributo `disabled` depende de un re-render que todavía no ocurrió).

**Historial y detalle del cliente** — con los tres estados (`loading` / `error` / `empty`) resueltos por componentes compartidos, y el snapshot de la compra tal como quedó guardado.

**Panel de administración** — listado global, filtro por estado resuelto **en Firestore** (no en memoria), y cambio de estado con confirmación que nombra la orden y los dos estados involucrados. Solo se ofrecen las transiciones válidas.

**Errores diferenciados** — `{ code, message, retryable }` con códigos propios para índice faltante, permisos, red y desconocido. Un índice faltante se marca como **no reintentable**: tarda un par de minutos en construirse, así que reintentar de inmediato produciría el mismo error en bucle.

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
| `npm run verify:rules` | Ejecuta las 23 pruebas de las reglas contra Firestore real |

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
         con createdAt == request.time y sin campos de más
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

Cubre los tres casos obligatorios del enunciado —un cliente no puede leer una orden ajena, un administrador sí puede cambiar el estado, y no puede tocar ningún otro campo— y veinte más.

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
- **Mensajes que no filtran información** — pedir una orden inexistente y pedir una ajena dan el **mismo** error. Distinguirlos permitiría probar ids al azar para averiguar cuáles corresponden a órdenes reales.

## Limitaciones conocidas

- **Un documento corrupto rompe todo el listado.** El converter valida con Zod y lanza si el documento no tiene la forma esperada, así que una orden malformada hace fallar la consulta entera en vez de omitirse. Es la contrapartida de validar estrictamente; la alternativa —descartar los inválidos en silencio— escondería el problema, que en un historial de compras es peor.
- **6 vulnerabilidades `moderate` sin resolver**, todas con la misma raíz: `uuid < 11.1.1`, que llega de forma transitiva a través de `firebase-admin`. Es una **devDependency** usada solo por `npm run seed`, así que nunca entra al bundle. No se aplica `npm audit fix --force` porque **degradaría** `firebase-admin` de `^14.2.0` a `10.3.0` — cuatro versiones mayores hacia atrás, con sus propios agujeros sin parchear, para tapar uno que no es alcanzable desde este código.
- **Sin paginación en el panel de administración.** Con muchas órdenes, el listado global las trae todas. Fuera del alcance de esta homework.

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

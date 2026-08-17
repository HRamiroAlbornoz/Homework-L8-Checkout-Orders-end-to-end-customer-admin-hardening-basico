# Release Candidate del E-commerce — Homework L7 (Henry, Módulo 5)

E-commerce multi-rol con React + TypeScript + Vite, Firestore y Firebase Authentication: catálogo con búsqueda y paginación, carrito persistente, checkout que registra órdenes, y panel de administración con subida de imágenes a S3 mediante URLs prefirmadas.

**Producción:** https://homework-l7-release-candidate-del-e.vercel.app/

| | |
|---|---|
| Tests | 390 en 22 archivos |
| CI | Lint, type-check, tests y build en cada push y PR |
| Checklist de producción | [`production-checklist.md`](production-checklist.md) |

## Stack

- **React 19 + TypeScript (strict) + Vite** — con `noUncheckedIndexedAccess` y `exactOptionalPropertyTypes`
- **Firebase Auth** (SDK modular v9+) — email/password
- **Firestore** — catálogo, perfiles de usuario y órdenes
- **react-router** v8 (paquete unificado, no `react-router-dom`)
- **Zod** — variables de entorno, datos de Firestore, formularios y `localStorage`
- **Vitest + Testing Library + MSW** — tests
- **Vercel** — hosting del frontend y una Serverless Function
- **AWS S3** — imágenes de productos, subidas con URL prefirmada

## Qué incluye

**Catálogo** — búsqueda por prefijo con debounce, filtro por categoría, paginación con cursor, y los tres estados (`loading`/`error`/`empty`) resueltos con componentes compartidos.

**Carrito** — reducer puro con totales siempre consistentes, persistencia en `localStorage` validada con Zod, y confirmación antes de vaciar que nombra los productos que se van a perder.

**Checkout** — crea la orden en Firestore con `serverTimestamp()`, con errores estructurados `{ code, message, retryable }` y doble protección contra el envío duplicado. **El precio de cada ítem se verifica contra el catálogo** en las reglas de seguridad: manipular el `localStorage` para comprar más barato no funciona.

**Panel de administración** — alta de productos con imagen. El navegador sube el archivo **directo a S3** con una URL firmada por el servidor: la clave de AWS nunca llega al cliente.

## Setup local

1. **Instalar dependencias**

   ```bash
   npm install
   ```

2. **Configurar las variables de entorno**

   ```bash
   cp .env.example .env
   ```

   Completá las 6 variables `VITE_FIREBASE_*` desde Firebase Console → Configuración del proyecto → Tus apps → SDK setup and configuration.

   Las variables `S3_*` solo hacen falta para el flujo de subida de imágenes, que corre en una Vercel Function y **no funciona con `npm run dev`** (Vite sirve el frontend, no `/api`). La app arranca sin ellas.

3. **Habilitar Email/Password** en Firebase Console → Authentication → Sign-in method. Es un paso manual, no hay código que lo haga.

4. **Cargar el catálogo de prueba** (opcional)

   ```bash
   npm run seed
   ```

   Requiere `FIREBASE_SERVICE_ACCOUNT_JSON` en el `.env`, **en una sola línea** (ver instrucciones en `.env.example`). El script usa el SDK de Admin porque las reglas de Firestore solo permiten crear productos a un administrador autenticado, y un script de Node no tiene sesión de usuario.

5. **Levantar el servidor**

   ```bash
   npm run dev
   ```

6. **Crear un usuario** desde `/signup`. Nace con `role: "customer"`, forzado por las reglas de seguridad. Para probar el panel de administración, cambiá `role` a `"admin"` desde Firestore Console → colección `users`. Ese ascenso solo puede hacerse desde la consola: el cliente tiene prohibido modificar su propio rol.

## Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo de Vite |
| `npm run build` | Type-check (`tsc -b`) + build de producción |
| `npm run test` | Suite completa de Vitest |
| `npm run lint` | ESLint sobre todo el repositorio |
| `npm run seed` | Carga productos de prueba (no hace nada si la colección ya tiene datos) |
| `npm run seed -- --force` | Los carga aunque ya existan |

## Rutas

| Ruta | Acceso | Página | Título de la pestaña |
|---|---|---|---|
| `/` | Público | Catálogo | `Catálogo` |
| `/login` | Público (redirige a `/` si ya hay sesión) | Autenticación | `Iniciar sesión` |
| `/signup` | Público (redirige a `/` si ya hay sesión) | Autenticación | `Crear cuenta` |
| `/cart` | **Público** | Carrito | `Carrito` |
| `/checkout` | Requiere sesión | Checkout | `Checkout` |
| `/admin` | Requiere sesión + `role === "admin"` | Panel de administración | `Panel de administración` |
| cualquier otra | Público | 404 | `Página no encontrada` |

`/cart` es pública a propósito: un visitante arma su carrito antes de registrarse (vive en `localStorage`) y la sesión recién se exige al pagar. Obligar a iniciar sesión para *ver* el carrito es fricción que hace abandonar compras.

**Cada página declara su propio título** con el hook `useDocumentTitle`, que le agrega ` | E-commerce Henry` al final. Es obligatorio en una pantalla nueva: el navegador carga `index.html` una sola vez, así que sin esa línea la pantalla hereda el título de la anterior. Los títulos de la tabla son los que se ven al navegar, sin recargar.

## Testing

```bash
npm run test              # toda la suite
npx vitest                # modo watch
npx vitest run <archivo>  # un archivo puntual
```

**Los tests no usan red real.** Firebase se mockea con `vi.mock` y las requests HTTP las intercepta MSW con `onUnhandledRequest: "error"`, así que cualquier request sin handler rompe el test en lugar de salir a internet. La suite pasa sin archivo `.env` y sin conexión.

La pirámide, de más a menos abundante:

- **Unitarios** — `cartReducer` (función pura, sin DOM ni mocks), schemas de Zod, mapeo de errores.
- **Integración** — hooks con `renderHook`, componentes con `userEvent`, flows completos con mocks del service (checkout) y con MSW (subida de imágenes).
- **Smoke tests manuales** — contra el despliegue real. Cubren lo único que los tests automatizados no pueden ver: el interior de la Vercel Function, que en los tests nunca se ejecuta porque MSW intercepta la request antes.

## Deploy

Desplegado en **Vercel**, con integración de GitHub: cada push a `main` actualiza producción y cada PR genera un deploy Preview.

**Variables de entorno** — en Vercel se cargan en Settings → Environment Variables, marcando **Production, Preview y Development**. Olvidar Preview hace fallar los deploys de rama mientras producción funciona, con un síntoma que no señala la causa.

| Variable | Prefijo | Dónde vive | ¿Se ve en el bundle? |
|---|---|---|---|
| `VITE_FIREBASE_*` (6) | `VITE_` | Navegador | **Sí** — son públicas por diseño |
| `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | *(ninguno)* | Vercel Function | No |

El prefijo `VITE_` no es una convención de nombres: es lo que hace que Vite **reemplace la variable por su valor dentro del bundle**. Cualquier cosa con ese prefijo es pública, aunque el repositorio sea privado.

> Los nombres no pueden ser `AWS_ACCESS_KEY_ID` ni `AWS_SECRET_ACCESS_KEY`: las Vercel Functions corren sobre AWS Lambda, donde esos nombres están reservados por el runtime.

**Reglas e índices de Firestore** — no se despliegan con la app:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

**Después de cambiar variables de entorno hay que redeployar**: no se aplican a builds ya construidos.

El procedimiento completo, con el plan de rollback y las verificaciones, está en [`production-checklist.md`](production-checklist.md).

## Seguridad

- **Contraseñas** — las maneja Firebase Auth; la app nunca las ve en texto plano ni las almacena.
- **Roles** — un usuario no puede modificar su propio `role`. Lo impide `firestore.rules`, no el frontend.
- **Mensajes de login** — nunca revelan si un email existe: credenciales inválidas, usuario inexistente y contraseña incorrecta comparten el mismo mensaje.
- **Dos capas independientes** — `ProtectedRoute`/`AdminRoute` son UX; `firestore.rules` es la protección real contra un cliente malicioso. Las reglas validan además la forma de cada documento.
- **Precio de las órdenes** — cada línea de la compra es un documento propio (`orders/{id}/items/{itemId}`), y su regla compara el precio contra el del catálogo con `get()`. Los totales no se guardan: se calculan al leer, a partir de líneas ya verificadas. *Lo que no se guarda no se puede falsear.*
- **Subida de imágenes** — el servidor firma pero nunca ve los bytes. La URL vence en 5 minutos, el `Content-Type` va firmado (para que no se pueda esquivar la whitelist), el nombre del archivo se genera con UUID —nunca el del cliente— y el usuario IAM solo puede `s3:PutObject` bajo un único prefijo.
- **Verificación de secretos en el bundle** — tras cada build se buscan los secretos en `dist/`. Ver el procedimiento en el checklist.

## Documentación de decisiones

- [`production-checklist.md`](production-checklist.md) — checklist de producción ejecutado, plan de rollback y 4 notas de debugging de problemas reales del deploy.
- [`docs/ai-notes.md`](docs/ai-notes.md) — uso de IA en L4 y L7: qué se aceptó, qué se rechazó y por qué, con evidencia.
- [`docs/auth-notes.md`](docs/auth-notes.md) — códigos de error de Firebase, el experimento sobre el estado `loading` en los guards, y el caso borde de un usuario autenticado sin perfil.
- [`docs/test-output.txt`](docs/test-output.txt) — salida completa de la suite.
- [`CLAUDE.md`](CLAUDE.md) — guía de arquitectura para trabajar sobre este repositorio.

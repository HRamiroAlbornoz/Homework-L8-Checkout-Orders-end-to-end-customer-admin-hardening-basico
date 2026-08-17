# Production Checklist — E-commerce Release Candidate

**URL de producción:** https://homework-l7-release-candidate-del-e.vercel.app/
**Repositorio:** https://github.com/HRamiroAlbornoz/Homework-L7-Release-Candidate-del-E-commerce
**Fecha de verificación:** 13 de agosto de 2026
**Segunda ronda (todos los flujos, manejando la app):** 14 de agosto de 2026

> Cada ítem marcado en este documento se **ejecutó**, no se dio por supuesto. Donde hubo algo que resolver, queda la nota.

---

## Build & Quality Gates

- [x] `npm run build` pasa localmente
  > 208 módulos, sin errores. El aviso sobre el tamaño del chunk de Firebase (~567 kB) está diagnosticado desde el Homework L4: es el peso irreducible del SDK, ya aislado en su propio chunk para que el navegador pueda cachearlo aparte del código de la app.

- [x] `npm run test` pasa (3 corridas seguidas)
  > 24 archivos, 429 tests, verde en las tres. Salida completa en [`docs/test-output.txt`](docs/test-output.txt).

- [x] `npm run lint` y `npx tsc -b --noEmit` sin errores
  > El type-check cubre los tres proyectos declarados en `tsconfig.json`: `src/`, `scripts/` y `api/`.
  > **Nota:** `api/` no estaba cubierto por ningún proyecto de TypeScript. Los errores de tipos del código que maneja los secretos habrían aparecido recién en producción. Se creó `tsconfig.api.json` y se verificó introduciendo un error a propósito para confirmar que ahora sí lo detecta.

- [x] Tests deterministas (sin llamadas reales a internet, Firebase o S3)
  > Firebase se mockea con `vi.mock`; las requests HTTP las intercepta MSW con `onUnhandledRequest: "error"`, así que cualquier request sin handler **rompe** el test en lugar de salir a la red.

- [x] **La suite pasa con el Wi-Fi desconectado**
  > Verificado cortando la conexión de red por completo: **390 tests en verde, 17.83s** — prácticamente el mismo tiempo que con internet, lo que confirma que ningún test estaba esperando una respuesta remota.
  >
  > (Eran 390 al momento de esa medición; los 27 tests que se sumaron después, al corregir los hallazgos del code review, tampoco tocan la red: mockean el SDK o usan MSW.)
  >
  > Dos verificaciones más apuntan a lo mismo desde otro ángulo: la suite pasa **sin archivo `.env`**, y el CI la corre en una máquina limpia sin ningún secreto configurado.

- [x] CI en verde antes de cada merge
  > GitHub Actions corre lint, type-check, tests y build en cada push y pull request. Ningún PR se mergeó en rojo.

---

## Seguridad & Variables de Entorno

- [x] No hay secretos en el repositorio
  > `.env` está en `.gitignore` (verificado con `git check-ignore -v .env` **antes** del primer commit, no después: un secreto commiteado queda en el historial para siempre aunque se borre luego).

- [x] `.env.example` documenta todas las variables, sin valores reales

- [x] Las variables públicas usan `VITE_` y se consumen con `import.meta.env`
  > Las 6 de configuración de Firebase. Son públicas **por diseño**: identifican al proyecto, no autorizan nada. Lo que protege los datos es `firestore.rules`, no ocultar estos valores.

- [x] Los secretos NO usan `VITE_` y solo se leen en el servidor con `process.env`
  > `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` y `S3_SECRET_ACCESS_KEY`, leídas únicamente por `api/uploads/presign.ts`.
  > **Nota:** no se pueden llamar `AWS_ACCESS_KEY_ID` ni `AWS_SECRET_ACCESS_KEY`. Las Vercel Functions corren sobre AWS Lambda, donde esos nombres están **reservados por el runtime** y serían pisados. De ahí el prefijo `S3_`.

- [x] **Se buscaron los secretos en el bundle de producción antes de deployar**
  > `npm run build` seguido de un grep sobre `dist/` con los patrones `AKIA`, `S3_SECRET`, `S3_ACCESS`, `SECRET_ACCESS_KEY`, `BEGIN PRIVATE KEY`, `service_account`, `private_key` y `firebase-adminsdk`: **0 coincidencias**.
  > El resultado negativo se validó buscando también el id del proyecto de Firebase —que sí debe estar— y encontrándolo. Sin esa contraprueba, un "no encontré nada" no distingue entre "no hay secretos" y "el método no busca bien".

- [x] Variables cargadas en **todos** los entornos de Vercel (Production, Preview y Development)
  > Olvidar Preview hace fallar los deploys de rama con una pantalla en blanco mientras producción funciona: un síntoma que no señala la causa.

- [x] Se redeployó después de cargar las variables
  > Las variables de entorno **no se aplican a deploys ya construidos**. El build existente sigue sin ellas hasta que se reconstruya.

- [x] La credencial de AWS tiene el mínimo privilegio posible
  > El usuario IAM `l7-ecommerce-presign` solo puede `s3:PutObject`, y solo bajo `products/*` de un único bucket. No puede leer, listar ni borrar. Si se filtrara, el daño posible es acotado.

- [x] La URL firmada es de corta duración y con el `Content-Type` firmado
  > `expiresIn: 300` (5 minutos) y `signableHeaders: new Set(["content-type"])`. Sin lo segundo, el cliente podría subir declarando cualquier tipo y saltearse la whitelist de imágenes.

- [x] El endpoint de subida verifica identidad y permisos
  > 401 si falta el token o es inválido, 403 si el usuario no es admin, 400 si los datos no cumplen. Los tres verificados contra producción.

- [x] Las reglas de Firestore están desplegadas y son la protección real
  > `firebase deploy --only firestore:rules,firestore:indexes`. Impiden que un usuario se autoasigne el rol admin, que cree órdenes a nombre de otro, y validan la forma de cada documento.

- [x] Se corrigieron los hallazgos de dos rondas de code review
  > Once hallazgos en total (5 sobre la Vercel Function, 6 sobre el resto), todos corregidos y cubiertos con tests. Ver la sección de notas de debugging.

- [x] Se corrigieron los hallazgos de la verificación de flujos (PR #15)
  > Cinco hallazgos, más uno que apareció **al verificar la corrección de otro**. Ninguno salió de leer código: los seis aparecieron manejando la aplicación. Ver la sección "Verificación de todos los flujos".

- [x] **El precio de cada ítem se verifica contra el catálogo**
  > Era la limitación de seguridad conocida del release candidate, y quedó cerrada.
  >
  > **El riesgo que había:** el precio de cada ítem viajaba desde el navegador y nada lo contrastaba con el catálogo. Editando `ecommerce:cart:v1` en el `localStorage` se podía comprar a cualquier precio.
  >
  > **Por qué no se podía cerrar antes:** el lenguaje de reglas no permite recorrer un array ni sumar sus elementos, así que `totalPrice` era inverificable mientras los ítems fueran un campo de la orden.
  >
  > **Lo que lo destrabó:** las reglas **sí** pueden leer otros documentos con `get()`. Los ítems pasaron a ser documentos de una subcolección (`orders/{id}/items/{itemId}`), y así cada uno tiene su propia evaluación de regla:
  >
  > ```
  > request.resource.data.unitPrice == precioDeCatalogo(request.resource.data.productId)
  > ```
  >
  > Los totales dejaron de guardarse: se calculan al leer, a partir de ítems ya verificados. *Lo que no se guarda no se puede falsear.*
  >
  > **Costo:** una lectura facturable por ítem al confirmar la compra, que se cobra aunque la regla rechace.
  >
  > **Efecto secundario aceptado:** si un admin cambia el precio de un producto, los carritos que ya lo tenían dejan de poder confirmarse. El checkout lo contempla con un mensaje que invita a revisar el carrito.
  >
  > **Verificado en producción**, en las dos direcciones:
  >
  > | Prueba | Resultado |
  > |---|---|
  > | Compra legítima de $131.410 | Orden `rrn7EKW4zawvgJHx8qgC` creada |
  > | Estructura del documento | Solo `userId`, `status`, `createdAt` — sin totales |
  > | Ítems en la subcolección | Dos documentos con el precio real |
  > | `unitPrice` bajado de 75.410 a 100 | **Rechazado** |
  > | Órdenes tras el intento fallido | **1 sola**: el batch es atómico, no quedó una orden huérfana |
  >
  > La primera fila importa tanto como las otras: una regla que bloquea el ataque **y también al usuario legítimo** no es una corrección, es una caída de servicio.
  >
  > **Alternativa descartada:** una Vercel Function que calculara el precio con el SDK de Admin. Habría exigido reintroducir `FIREBASE_SERVICE_ACCOUNT_JSON` en Vercel — una credencial con acceso total al proyecto, que se eliminó a propósito al rediseñar el presign. Cambiar un riesgo de precios acotado por un secreto con acceso total es un mal negocio.

- [ ] Vulnerabilidades de dependencias resueltas
  > **Quedan 6 moderadas**, todas la misma: `uuid` a través de `firebase-admin → @google-cloud/storage`. Se dejan a conciencia:
  > 1. Son **moderadas**, no altas ni críticas.
  > 2. El fallo es un chequeo de límites en `uuid` v3/v5/v6 **cuando se le pasa un buffer propio**, algo que ni `firebase-admin` ni este código hacen.
  > 3. El único arreglo disponible sería bajar `firebase-admin` de la 14 a la 10, lo cual es peor que el problema.
  > 4. `firebase-admin` es **devDependency**: solo lo usa `scripts/seed.ts`, que corre localmente. **No se instala en producción.**
  >
  > Las 7 vulnerabilidades **altas** que aparecieron al instalar dependencias sí se resolvieron, quitando `@vercel/node` (ver notas de debugging).

---

## App Smoke Tests (Production)

Verificados sobre la URL de producción, con la consola del navegador abierta.

- [x] La home/catálogo carga sin errores
  > 20 productos desde Firestore, con paginación y búsqueda.

- [x] Los deep links funcionan (`/cart`, `/checkout`, `/admin`)
  > Sin 404: el rewrite de `vercel.json` devuelve `index.html` para cualquier ruta y React Router resuelve el resto.

- [x] Registro, login y logout funcionan
  > **Nota:** hubo que agregar el dominio de Vercel en Firebase Console → Authentication → Configuración → Dominios autorizados. Sin eso el login falla en producción con `auth/unauthorized-domain` aunque las credenciales sean correctas.

- [x] El perfil nuevo se crea con rol `customer` forzado por las reglas

- [x] Carrito: agregar, cambiar cantidad, eliminar y vaciar con confirmación
  > La confirmación de vaciado nombra los productos que se van a perder.

- [x] El carrito persiste entre navegaciones y recargas (`localStorage`)

- [x] Checkout crea una orden real y muestra la confirmación
  > Orden `5VGoWnWBDMyUKHfEGgUX` creada en Firestore. Valida de punta a punta las reglas desplegadas: `userId == request.auth.uid`, `status == 'created'` y `createdAt == request.time`.

- [x] El carrito se vacía **solo** si la compra se registró

- [x] Un usuario `customer` no puede acceder al panel de administración
  > Verificado con una cuenta de prueba de rol `customer`: `/admin` redirige a `/`, y el link tampoco aparece en el header.

- [x] Admin crea un producto con imagen
  > Secuencia verificada en la pestaña Network: `POST /api/uploads/presign` (200) → `PUT` a S3 (200) → escritura en Firestore (200) → `GET` público de la imagen (200). El producto aparece en el catálogo con su imagen.

- [x] Consola del navegador sin errores ni advertencias en todos los flujos

---

## Verificación de todos los flujos (14 de agosto de 2026)

Segunda pasada, más ancha que los smoke tests de arriba: se recorrió **cada flujo de la app** manejando la interfaz, no leyendo código ni corriendo tests. El criterio fue no quedarse en el camino feliz — cada flujo incluye al menos un intento de romperlo.

**Catálogo**

- [x] 20 productos, orden alfabético, "Cargar más" trae 20 más sin duplicar ni saltear
- [x] Búsqueda: `apple` → 3 resultados; `zzzz` → estado vacío con el término en el mensaje
- [x] Búsqueda + categoría combinadas → *"No hay resultados para «zzzz» en la categoría Ropa."*
- [x] **Una sola letra no dispara la búsqueda** (mínimo de 2 caracteres) y el filtro de categoría sobrevive

**Carrito** — se verificó sin sesión, que es como debe funcionar

- [x] El mismo producto dos veces suma cantidad en una línea, no duplica la línea
- [x] Bajar la cantidad a 0 quita la línea y recalcula los totales
- [x] **`localStorage` con totales mentidos** (`totalItems: 999, totalPrice: 1`) → corregidos solos al leer, y reescritos normalizados
- [x] **`localStorage` con el schema roto** → carrito vaciado sin crashear, con salida al catálogo

**Guards y errores**

- [x] `/checkout` y `/admin` sin sesión → `/login`
- [x] `/admin` **con sesión pero sin rol admin** → `/`, sin destello del panel
- [x] `/login` con sesión ya iniciada → `/`
- [x] Ruta inexistente → 404 con salida, un solo landmark `main`

**Autenticación**

- [x] Registro real, sesión que sobrevive a la recarga, y logout que expulsa de una ruta protegida
- [x] Registro con un email ya usado → mensaje claro, sin crear nada
- [x] **Login con email inexistente → mensaje genérico**, que no revela si el email existe
- [x] Validaciones que cortan antes de tocar la red: campo vacío, email inválido, contraseña corta, sin número, confirmación distinta
- [x] Una contraseña de 3 caracteres **no** da error en login: la regla de 8 es solo de registro

**Checkout — las dos direcciones**

- [x] `unitPrice` manipulado de 12590 a **100** → rechazado por las reglas, carrito intacto, **ninguna orden creada**
- [x] Compra legítima de $20.700 → orden `dSMouuRUnPNKshlSnquf`, carrito vaciado
- [x] Checkout con carrito vacío → sin botón de confirmar, con salida al catálogo

**Panel de administración**

- [x] El enlace del header aparece **solo** con rol admin
- [x] Precios inválidos rechazados: negativo, cero y desmesurado, cada uno con su mensaje
- [x] **Un `.txt` saltándose el filtro `accept`** → rechazado en el navegador, sin request
- [x] Alta real: `presign` (200) → `PUT` a S3 (200) → escritura en Firestore, con nombre de archivo UUID y `X-Amz-Expires=300`
- [x] **Doble click inmediato en "Crear producto"** → un solo producto creado; el `useRef` gana la carrera al re-render
- [x] El producto creado desde el panel se puede comprar: orden `MD4HosIJA31a6rIyZE5a`

**Endpoint de firma, atacado desde la consola del navegador**

| Request | Respuesta |
|---|---|
| Sin `Authorization` | `401 UNAUTHENTICATED` |
| `Bearer` con basura | `401 INVALID_TOKEN` |
| Token válido + `application/x-msdownload` | `400 INVALID_UPLOAD` |
| Token válido + **`image/svg+xml`** | `400 INVALID_UPLOAD` |
| Token válido + 6 MB | `400 INVALID_UPLOAD` |
| Token válido + body vacío o no-JSON | `400 INVALID_UPLOAD` |

> El rechazo del SVG es el más valioso de la tabla. El navegador lo trata como imagen, pero un SVG es un documento que **puede ejecutar JavaScript**. Que el servidor lo niegue muestra que la whitelist se armó pensando en qué formato es peligroso, no en cuáles son cómodos.

- [x] Contraste WCAG AA medido en vivo contra el fondo real heredado: **0 incumplimientos**
- [x] Consola limpia en los siete flujos

**Los seis hallazgos y su corrección** (todos en el PR #15):

| Hallazgo | Corrección |
|---|---|
| El panel de admin era la única pantalla sin centrar | Se acota la columna entera, no la tarjeta |
| El checkout no tenía enlace de vuelta al carrito, aunque el mensaje de error lo pedía | Fila de acciones con el enlace junto al botón |
| El precio aceptaba 3 decimales | `multipleOf(0.01)` en el schema + `step` en el input |
| Los 5 motivos de rechazo de una subida devolvían el mismo mensaje | `details.kind`, manteniendo un solo `code` |
| Un archivo de 0 bytes recibía el mensaje opuesto a su problema | `kind: INVALID_SIZE`, leyendo `too_big` vs `too_small` |
| El `<title>` no cambiaba en ninguna de las 7 rutas | Hook `useDocumentTitle`, una línea por página |

**Verificación final, con las seis correcciones en un mismo build.** Cada una se había verificado por separado —tres contra `vite dev`, dos contra un Preview anterior— y ninguna pasada las había ejercitado juntas. Antes del merge se recorrió el Preview del HEAD de la rama, y después del merge se repitió sobre producción:

- [x] Las 7 rutas con su título en el **build minificado y con code splitting**
  > No es lo mismo que en desarrollo: `/checkout` y `/admin` son chunks que se descargan aparte, con `React.lazy` y un `Suspense` en el medio, así que el orden en que se resuelven los efectos —y quién escribe el título último— podía diferir.

- [x] Checkout en las dos direcciones sobre el build final
  > Precio manipulado a $99 → rechazado con el enlace al carrito visible a 16 px del error. Compra legítima de $83.520 → orden `cw5h1hyPJLCET0plTMXo`.

- [x] **Sin regresión en el catálogo**
  > Tres de los seis commits tocan `src/index.css`, el mismo archivo donde vive la alineación de las tarjetas corregida en el PR #14. Medido: `diferenciaPorFilaEnPx: [0,0,0,0,0]` en las cinco filas, sin desborde horizontal.

- [x] El commit desplegado coincide con el HEAD de `main` (`41d81b6`)
  > Esta vez Vercel disparó el build de producción por su cuenta, a diferencia de la nota 3. Se comprobó igual: es un chequeo de dos segundos y es la diferencia entre "mergeé" y "está en producción".

> **Un detalle de la corrida que vale como advertencia.** En la primera pasada sobre producción, `/login` y `/signup` redirigieron a `/` y sus títulos no aparecieron. No era un fallo: era la sesión de las pruebas anteriores, todavía viva, comportándose exactamente como debe. Dar esa medición por buena habría dejado dos rutas reportadas como verificadas sin estarlo. **Verificar una pantalla exige primero estar en las condiciones en que esa pantalla existe.**

---

## Observabilidad mínima (manual)

- [x] Se revisó la pestaña Network ante fallos
  > Fue lo que confirmó el orden de las requests del flujo de subida y que el `PUT` a S3 devolvía 200.

- [x] Se revisaron los logs de Vercel (Build / Runtime / Functions) ante fallos
  > **Fue determinante.** Los dos errores de la Vercel Function devolvían al cliente un `500 FUNCTION_INVOCATION_FAILED` sin ningún detalle — a propósito, para no filtrar información interna. La causa real (`ERR_MODULE_NOT_FOUND` y después `ERR_REQUIRE_ESM`) solo estaba en los logs del servidor.

- [x] Se verificó que el commit desplegado coincide con el HEAD de `main`
  > ```bash
  > gh api repos/HRamiroAlbornoz/Homework-L7-Release-Candidate-del-E-commerce/deployments \
  >   --jq '[.[] | select(.environment=="Production")][0].ref[0:7]'
  > git rev-parse --short HEAD
  > ```
  > **Nota:** este chequeo se agregó porque el problema ocurrió de verdad (ver nota de debugging 3).

---

## Plan de rollback

Si un deploy rompe producción:

1. **Vercel → Deployments → el último deployment estable → ⋯ → Promote to Production.** Es instantáneo: reusa un build que ya existe, sin recompilar.
2. Si el problema está en las reglas de Firestore, `firebase deploy --only firestore:rules` desde un commit anterior.
3. Recién después, investigar con calma sobre una rama.

El orden importa: primero se restablece el servicio, después se busca la causa.

---

## Notas de debugging

### 1. La función crasheaba con `ERR_MODULE_NOT_FOUND`

**Síntoma:** todo el endpoint devolvía `500 FUNCTION_INVOCATION_FAILED`, sin detalle.

**Causa:** `package.json` declara `"type": "module"`, así que la función corre como ESM. El resolvedor de ESM de Node **no completa extensiones**, y el import era `from "../../src/constants/uploads"`. Vite sí las completa, y por eso en desarrollo nunca se notó.

**Corrección:** `from "../../src/constants/uploads.js"` — con la extensión del archivo **compilado**, que es el que existe en tiempo de ejecución.

**Por qué ningún test lo detectó:** los tests con MSW interceptan la request HTTP y devuelven una respuesta falsa, así que **el código de la función nunca se ejecuta**. Los tests cubren el contrato entre el frontend y el endpoint, no el interior del endpoint. Solo un smoke test contra el despliegue real podía encontrarlo.

### 2. `ERR_REQUIRE_ESM` por una dependencia de `firebase-admin`

**Síntoma:** el mismo 500 opaco, con otra causa en los logs.

**Causa:** `firebase-admin` → `jwks-rsa` (CommonJS) → `require("jose")`, pero `jose` 6 es **solo ESM**. Node 24 admite `require()` de ESM; el runtime de las Vercel Functions no.

**Corrección:** se sacó `firebase-admin` de la función y se verifica el token con `jose` directamente. El rol se lee por la API REST de Firestore **con el token del propio usuario**, así que quien autoriza es `firestore.rules` y no un SDK con acceso total.

**Beneficio inesperado:** desapareció la necesidad de tener el service account en Vercel. Una credencial con acceso total al proyecto que deja de vivir en un servidor es una superficie de ataque menos.

### 3. Un merge en verde con producción sirviendo código viejo

**Síntoma:** PR mergeado, CI en verde, y el endpoint seguía fallando igual.

**Causa:** Vercel no disparó el build de producción. El árbol de archivos del merge era idéntico al de un Preview que ya existía, así que dedupllicó el build — pero tampoco movió el alias de producción. Nada lo señalaba: ni error, ni deploy fallido, ni aviso.

**Corrección:** promover el Preview a Production desde el dashboard.

**Lección, ahora en el checklist:** "el CI está verde y mergeé" **no** significa "producción tiene mi código". La verificación correcta es comparar el commit desplegado contra el HEAD de `main`.

### 4. Conflicto de git imposible de resolver tras un squash merge

**Síntoma:** `gh pr merge` respondía *"the merge commit cannot be cleanly created"* en un PR de un solo archivo.

**Causa:** el `--squash` del PR anterior comprimió 18 commits en uno solo sobre `main`; los originales nunca llegaron ahí. Al seguir trabajando sobre la misma rama, git veía dos historias independientes tocando los mismos archivos.

**Corrección:** reconstruir la rama sobre `main` (`git checkout -B rama origin/main`) y traer solo el commit de la corrección con `cherry-pick`.

**Regla que lo evita:** después de un squash merge, la rama se descarta. Rama nueva desde `main` actualizado para cada PR.

### 5. Fallo intermitente local: la suite entera no carga (solo en Windows)

**Síntoma:** ocasionalmente, `npm run test` reporta que **los 22 archivos fallaron** y `Tests no tests`, con un error apuntando al `afterEach` de `src/test/setup.ts` (*"Vitest failed to find the current suite"*). La corrida siguiente pasa en verde sin tocar nada.

**Lo que se pudo determinar con evidencia:**

- Ocurrió **5 veces**, siempre en la ejecución **inmediatamente posterior a escribir varios archivos**.
- Nunca ocurrió en una corrida aislada: entre incidentes se encadenaron más de 20 ejecuciones limpias seguidas.
- **Nunca ocurrió en el CI** (Ubuntu), en ninguna de sus corridas.
- No se pudo reproducir a demanda, ni editando un archivo y ejecutando de inmediato, ni forzando la recompilación con `touch`.

**Hipótesis (no confirmada):** una carrera entre el proceso que escribe los archivos y Vitest leyéndolos. El error señala un hook sin suite a la que engancharse, que es lo que ocurre cuando **ningún archivo de test pudo evaluarse**. En Windows, el antivirus bloquea brevemente los archivos recién escritos para escanearlos, lo que explicaría la intermitencia, la exclusividad de la plataforma y la imposibilidad de reproducirlo a voluntad.

**Estado:** no afecta a la entrega. El CI —que descarga los archivos una vez y recién después ejecuta, sin escrituras concurrentes— nunca lo manifestó. Si aparece localmente, volver a correr la suite.

Se registra igual, y sin conclusión forzada: **un problema que no se pudo reproducir se documenta como hipótesis, no como causa.** Escribir "era el antivirus" sin haberlo demostrado le haría creer al próximo que el asunto está cerrado.

### 6. Un total de $0 registrable manipulando el localStorage

**Detectado por:** code review (`/code-review high 1`), no por los tests.

**Causa:** la regla de creación de `orders` validaba `totalPrice >= 0` y no restringía qué campos podía traer el documento. Y una defensa propia lo volvía invisible: `loadCartState` recalcula los totales a partir de los ítems, así que un `unitPrice: 0` editado a mano en el `localStorage` producía un estado **internamente coherente** que pasaba la validación de Zod sin problema.

La lección: **recalcular no es lo mismo que verificar.** Los totales eran consistentes con los ítems; lo que nunca se comprobó fue que los ítems tuvieran el precio real.

**Corrección:** `keys().hasOnly([...])` para rechazar campos ajenos, tope de 50 líneas por orden, y `totalPrice > 0`.

**Verificado en producción**, en las dos direcciones:

| Escenario | Resultado |
|---|---|
| Compra legítima de $75.410 | Orden `oo4OoRqye0rLpluUj0zr` creada ✅ |
| `localStorage` manipulado a `unitPrice: 0` | Rechazado por Firestore, con mensaje genérico ✅ |

**Lo que queda abierto:** los precios distintos de cero siguen viniendo del cliente. Ver el ítem sin tildar en la sección de seguridad.

### 7. Una configuración de TypeScript que permitía el bug de la nota 1

**Detectado por:** code review, al revisar `tsconfig.api.json`.

**Causa:** `moduleResolution: "bundler"` para código que corre como ESM real de Node. Con esa opción, un import relativo sin extensión pasa `tsc`, el lint y el CI, y recién falla en producción — que es exactamente lo que había ocurrido en la nota 1, corregido a mano sin tocar la causa.

**Corrección:** `nodenext`. Verificado quitando la extensión a propósito:

```
error TS2835: Relative import paths need explicit file extensions in ECMAScript
imports when '--moduleResolution' is 'node16' or 'nodenext'.
Did you mean '../../src/constants/uploads.js'?
```

Es la nota más útil de todas, porque no arregla un error: **elimina la posibilidad de cometerlo**. Arreglar el bug sin arreglar lo que lo permitió deja el mismo bug esperando a la próxima persona.

### 8. Las reglas no filtran las consultas: las rechazan enteras

**Detectado al verificar en producción** que los ítems de una orden se hubieran escrito bien.

**Síntoma:** leer el documento de la orden con la API REST funcionaba, pero **listar su subcolección devolvía `403 PERMISSION_DENIED`** — aunque la regla es `allow read: if resource.data.userId == request.auth.uid` y todos los documentos cumplían esa condición.

**Causa:** para una consulta (`list`), Firestore **no filtra los resultados por vos**. Evalúa la regla contra la *consulta*, no contra los documentos, y exige que esté acotada de forma que **garantice** que todo lo que pueda devolver cumple la regla. Un listado sin filtro no ofrece esa garantía, así que se rechaza entero.

La misma consulta con el filtro que la regla exige devuelve los datos sin problema:

```js
where("userId", "==", uid)
```

**Consecuencia para el futuro, que es lo que vale la pena registrar:** una pantalla de "mis órdenes" **debe** incluir ese `where` en la consulta. No alcanza con confiar en que la regla filtre — no filtra. Y el modo de fallo es engañoso: un `403` que parece un problema de permisos del usuario cuando en realidad es una consulta mal construida.

**Estado:** no es un bug del proyecto. Las reglas y los datos están bien; lo que estaba mal era mi forma de consultarlos al verificar. Queda documentado para que la próxima persona que liste una colección protegida no pierda una tarde con esto.

### 9. Una medición correcta que contestaba la pregunta equivocada

**Contexto:** el panel de administración era la única pantalla sin centrar. La corrección obvia era centrar la tarjeta del formulario: `margin: 24px auto 0`.

**La medición confirmó el arreglo:** 310 px de margen a cada lado, tarjeta perfectamente centrada.

**Lo que la medición no podía mostrar:** el `<h1>` seguía arrancando en el borde izquierdo. Antes del cambio los dos elementos estaban pegados a la izquierda — feos, pero **alineados entre sí**. Después, cada uno quedó en un eje distinto. El defecto no vivía en la tarjeta: vivía en la *relación* entre la tarjeta y el título.

Apareció en una captura de pantalla, no en un número.

**Corrección definitiva:** acotar la columna entera (`.admin-page { max-width: 560px }`) y quitarle a la tarjeta su `max-width` propio, para que ocupe el ancho de la columna. Así la alineación se cumple sola en cualquier breakpoint, en vez de depender de que dos anchos fijos coincidan con el `padding` de turno.

**La lección, que es distinta de la del hallazgo anterior sobre alineaciones:** un número aislado responde por un elemento; un defecto de composición vive **entre** elementos. Medir el objeto que tocaste confirma que lo tocaste bien, no que la pantalla quedó bien. Para eso hay que mirarla.

### 10. El arreglo de un mensaje confuso escondía un mensaje al revés

**Detectado al verificar la corrección de otro hallazgo**, no al escribirla.

**Contexto:** los cinco motivos de rechazo del endpoint de subida devolvían el mismo texto. Se agregó `details.kind` para distinguirlos, y al probar los casos uno por uno contra el Preview desplegado apareció esto:

| Enviado | Respuesta |
|---|---|
| `size: 6 MB` | `kind: SIZE` — *"no puede pesar más de 5 MB"* ✅ |
| **`size: 0`** | `kind: SIZE` — *"no puede pesar más de 5 MB"* ❌ |

Un archivo de 0 bytes recibía el consejo **opuesto** a su problema: buscá una imagen más chica.

**Por qué importa:** no es un caso rebuscado. Una descarga que se cortó deja un archivo con nombre, extensión y hasta `type` correctos, porque el navegador deduce el tipo de la extensión **sin mirar el contenido**.

**Causa:** la clasificación miraba **qué campo** falló (`size`) y no **por qué** falló. Dos problemas opuestos del mismo campo caían en la misma categoría.

**Corrección:** leer el motivo del issue de Zod.

```ts
if (problemaDelTamano?.code === "too_big") return "SIZE";
if (problemaDelTamano?.code === "too_small") return "INVALID_SIZE";
```

Y la misma comprobación en `validateImageFile`, para que el usuario se entere en su propia máquina: verificado subiendo un PNG real de 0 bytes, con **0 requests al presign**.

**La lección:** verificar caso por caso encuentra cosas que verificar "que ande" no encuentra. La corrección original funcionaba —los cinco motivos ya se distinguían— y aun así dejaba un mensaje que decía lo contrario de la verdad. El defecto solo se ve cuando se leen las respuestas **de a una**, comparando cada una con la pregunta que la generó.

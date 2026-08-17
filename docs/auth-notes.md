# Notas de autenticación — Homework L6

Documentación de las decisiones y observaciones pedidas en el enunciado.

## 1. Códigos de error de Firebase Auth

Antes de armar la tabla, se consultó la lista oficial y completa de `AuthErrorCodes` del SDK modular (`firebase/auth`, vía Context7 apuntando al repo `firebase/firebase-js-sdk`), para no inventar códigos de memoria. De esa lista se eligieron los que tienen sentido para un formulario de **email + contraseña** (sin proveedores sociales, sin MFA, sin verificación de email) y se descartó el resto.

Los mensajes en español viven en `src/lib/authErrors.ts`, en un único mapa (`AUTH_ERROR_MESSAGES`) reutilizado por `login`, `signup` y `logout` a través de `mapAuthError()`.

### 1.1 Signup (`createUserWithEmailAndPassword`) — incluidos

| Código | Mensaje mostrado | Por qué se incluyó |
|---|---|---|
| `auth/email-already-in-use` | "Ya existe una cuenta registrada con ese email." | El más común en un signup real: alguien intenta registrarse con un email que ya tiene cuenta. |
| `auth/weak-password` | "La contraseña debe tener al menos 6 caracteres." | Firebase exige 6+ caracteres; aunque `signupFormSchema` (Zod) ya lo valida antes de llamar a Firebase, se mantiene el mapeo como defensa en profundidad (ej. si algún día se relaja la validación del form). |
| `auth/operation-not-allowed` | "El registro con email y contraseña no está habilitado en este momento." | Ocurre si el proveedor Email/Password no está habilitado en Firebase Console (Paso 1 del enunciado) — útil en desarrollo si alguien se olvida ese paso. |

### 1.2 Signup — descartados (con justificación)

| Código | Por qué se descartó |
|---|---|
| `auth/missing-password` | Client-side ya bloquea el envío si la contraseña está vacía (`signupFormSchema`); Firebase nunca llega a recibir ese caso desde este formulario. |
| `auth/internal-error` | Error genérico interno del SDK, no accionable con un mensaje específico; cae en el mensaje de fallback (`FALLBACK_MESSAGE`). |
| `auth/invalid-api-key`, `auth/app-deleted`, `auth/auth-domain-config-required` | Indican un error de **configuración del proyecto** (`.env` mal armado, proyecto de Firebase mal creado), no algo que un usuario final vea en producción — se detectarían en desarrollo, no ameritan traducción al usuario. |
| `auth/quota-exceeded` | Se usa para límites de operaciones específicas (ej. SMS de verificación telefónica), no aplica a email/password. |

### 1.3 Login (`signInWithEmailAndPassword`) — incluidos

| Código | Mensaje mostrado | Por qué se incluyó |
|---|---|---|
| `auth/invalid-credential` | "Email o contraseña incorrectos." | En el SDK v9+, este es el código que Firebase devuelve por defecto ante credenciales incorrectas (unifica los casos históricos de usuario inexistente y contraseña incorrecta). |
| `auth/user-not-found` | "Email o contraseña incorrectos." | Se mantiene por compatibilidad (algunas configuraciones/versiones todavía lo devuelven por separado) — **mismo mensaje** que `invalid-credential` a propósito. |
| `auth/wrong-password` | "Email o contraseña incorrectos." | Mismo motivo que el anterior. |
| `auth/user-disabled` | "Esta cuenta fue deshabilitada. Contactá al administrador." | Caso real: un admin deshabilitó la cuenta desde Firebase Console. |

**Decisión de seguridad explícita:** `invalid-credential`, `user-not-found` y `wrong-password` devuelven **el mismo mensaje genérico**. Nunca se le dice al usuario cuál de las dos cosas falló — revelar "el usuario no existe" permite a un atacante enumerar qué emails están registrados en el sistema (user enumeration), algo que tu CLAUDE.md prohíbe explícitamente.

### 1.4 Login — descartados

| Código | Por qué se descartó |
|---|---|
| `auth/missing-password` | Igual que en signup: el form ya bloquea el envío con contraseña vacía. |
| `auth/user-token-expired` | Se resuelve de forma transparente por el SDK (refresco de token); no llega como error a un submit de login. |
| `auth/requires-recent-login` | Solo aplica a operaciones sensibles (cambiar email/contraseña, eliminar cuenta) que este homework no implementa. |
| `auth/multi-factor-auth-required` | No hay autenticación multifactor implementada. |

### 1.5 Compartidos entre signup y login

| Código | Mensaje mostrado | Por qué |
|---|---|---|
| `auth/invalid-email` | "El email ingresado no es válido." | Puede llegar a Firebase igual que al form (ej. un email con formato válido para el regex de Zod pero rechazado por Firebase); defensa en profundidad. |
| `auth/too-many-requests` | "Demasiados intentos fallidos. Probá de nuevo en unos minutos." | Firebase tiene rate limiting propio ante intentos repetidos fallidos, tanto en signup como en login. |
| `auth/network-request-failed` | "Hubo un problema de conexión. Revisá tu internet e intentá de nuevo." | Cualquier operación de red puede fallar por conectividad, no es específico de un flujo. |

**Descartados también acá:** cualquier código relacionado con proveedores sociales/OAuth (`auth/popup-blocked`, `auth/popup-closed-by-user`, `auth/cancelled-popup-request`, `auth/account-exists-with-different-credential`) — este proyecto solo implementa Email/Password, nunca hay un popup de Google/Facebook que se pueda cerrar o bloquear.

## 2. Experimento: comentar el chequeo de `loading` en ProtectedRoute

**Qué se hizo:** en `src/routes/ProtectedRoute.tsx` se comentó temporalmente el bloque:

```tsx
// if (loading) {
//   return <LoadingState message="Verificando sesión..." />;
// }
```

dejando activo solo el chequeo `if (!user) { return <Navigate to="/login" replace />; }`.

**Cómo se observó:** en vez de recargar manualmente el navegador, se usó el propio test suite (`src/routes/ProtectedRoute.test.tsx`) como instrumento de observación — es un método reproducible y no depende de cronometrar a mano una recarga de página. El test `"mientras loading es true, muestra el spinner y no redirige ni muestra el contenido"` simula exactamente el estado transitorio real: `{ user: null, loading: true }` (el valor inicial de `AuthContext` mientras Firebase todavía no confirmó la sesión).

**Qué se observó exactamente:** el test falló. El DOM renderizado pasó de mostrar el spinner (`role="status"`, `"Verificando sesión..."`) a mostrar directamente:

```html
<body>
  <div>
    <p>Página de login</p>
  </div>
</body>
```

Es decir: **la ruta protegida redirigió a `/login` durante el estado de carga**, sin importar si el usuario estaba realmente logueado o no.

**Por qué pasa (causa raíz):** `AuthContext` arranca con el estado inicial `{ user: null, loading: true }` y solo actualiza `user` a un valor real (o confirma que es `null`) dentro del listener `onAuthStateChanged`, que es asíncrono. Mientras esa confirmación no llegó, `user` vale `null` **por diseño**, sin importar si hay o no una sesión real activa en el navegador — ese `null` transitorio significa *"todavía no se sabe"*, no *"no hay sesión"*. Si `ProtectedRoute` evalúa `!user` sin haber filtrado primero el caso `loading`, trata ese `null` transitorio exactamente igual que un `null` definitivo (usuario realmente no logueado), y redirige.

**Impacto real:** cualquier usuario con una sesión válida que recargue la página en `/cart` o `/checkout` sería expulsado a `/login` por una fracción de segundo (el tiempo que tarda `onAuthStateChanged` + la lectura del perfil en Firestore), aunque su sesión sea perfectamente válida. Con `BrowserRouter`, esa redirección con `replace` reemplaza la entrada del historial, así que además se pierde el intento de acceder a `/cart` sin que el usuario lo note necesariamente — un bug silencioso y muy difícil de reproducir a ojo si la conexión es rápida.

**Restauración:** el bloque comentado se restauró de inmediato después de capturar la evidencia. Se confirmó con `npx vitest run` y `npx tsc -b --noEmit` que el proyecto quedó exactamente como antes del experimento.

## 3. Code review de seguridad con IA

Se usó el prompt exacto sugerido por el enunciado (Paso 7), aplicado sobre el código real ya implementado en este repo (`AuthContext.tsx`, `ProtectedRoute.tsx`, `AdminRoute.tsx`, `usersService.ts`, `firestore.rules`). Resultado, con al menos 3 observaciones evaluadas:

| # | Observación | Categoría | ¿Se implementó? |
|---|---|---|---|
| 1 | Las reglas de `create` en `firestore.rules` fuerzan `role == 'customer'`, pero no validan el **tipo ni la forma** del resto de los campos (`email`, `displayName`, `createdAt`). Un cliente que escriba directo con el SDK (saltándose `createUserProfile`) podría crear un documento con `email: 123` o sin `createdAt`. Como Zod valida al leer (`userDocSchema.parse`), ese documento corrupto haría fallar la propia sesión de ese usuario al leer su perfil — no es una escalada de privilegios, pero sí un "auto-DoS" evitable. | **Vulnerabilidad real (menor)** | Sí — implementado en una ronda de fixes posterior. La regla `allow create` de `users/{uid}` (`firestore.rules`, líneas 55-61) ahora valida, además de `role == 'customer'`: `request.resource.data.email is string` y `.size() > 0`, `request.resource.data.displayName is string`, y `request.resource.data.createdAt == request.time` (el patrón oficial de Firebase para confirmar que el campo se escribió con `serverTimestamp()` real). Un documento con `email: 123` o sin `createdAt` ya no pasa la regla de creación. |
| 2 | Si el rol de un usuario se cambia manualmente en Firestore Console mientras esa persona tiene una sesión activa en el navegador (ej. se lo degrada de `admin` a `customer`), `AuthContext` **no se entera hasta el próximo `onAuthStateChanged`** (que solo dispara por cambios de sesión de Auth, no por cambios en el documento de Firestore). El usuario degradado conserva acceso de UI a `/admin` hasta que recargue la página. | **Bug de lógica / problema de autorización (medio, mitigado)** | No — el impacto real hoy es cero porque `/admin` es un placeholder sin operaciones sensibles; queda documentado para cuando la Clase 7 agregue escritura real de productos, momento en el que además `firestore.rules` debe exigir el rol admin en cada escritura (defensa en profundidad: aunque la UI muestre el panel de más, el servidor igual rechazaría la escritura de alguien ya no-admin). |
| 3 | El caso borde "usuario autenticado sin perfil en Firestore" (documentado en la sección 5) dejó una decisión de diseño discutible: no se fuerza `signOut()` para evitar la carrera con el propio listener, pero eso deja la sesión de Firebase Auth "viva" indefinidamente en el navegador mientras la UI la trata como cerrada. Si el error nunca se resuelve, el usuario queda sin una vía clara para des-loguearse (el botón de logout del `Header` solo aparece cuando `user` no es `null`). | **Bug de lógica / mejora de UX (menor)** | No — es un caso extremadamente raro en la práctica (solo ocurre si `getUserProfile` falla incluso después de sus 3 reintentos), y agregar una UI de recuperación específica para ese estado excede el alcance de este homework. Documentado como deuda técnica conocida. |
| 4 | Las reglas de `users/{uid}` en `firestore.rules` son la protección real contra que un usuario se autoasigne el rol `admin` — el código de React (`createUserProfile` sin parámetro `role`) es solo la primera capa, no la única. Esto es exactamente "lo que debería resolverse en Firestore Rules y no en React" que pide el enunciado. | **Problema de autorización → ya resuelto en Firestore Rules** | Sí — implementado en el Paso 11 (`firestore.rules`, reglas `create`/`update` de `users/{uid}`). |

**Qué queda fuera de React por diseño** (para la pregunta explícita del enunciado sobre qué debería resolverse en Firestore Rules): la inmutabilidad del campo `role` una vez creado el documento, y — a futuro, cuando exista escritura real de productos — que solo un `admin` pueda escribir en `products/{productId}`. Ninguna de las dos cosas puede garantizarse solo con `AdminRoute` o con ocultar UI: son controles de acceso a **datos**, y los datos se protegen donde viven.

## 4. Preguntas de reflexión

**¿Qué pasaría si las funciones de login y signup llamaran a `setUser` directamente en lugar de confiar en `onAuthStateChanged`? ¿Qué problema podría surgir?**

Se generaría una carrera entre dos caminos distintos escribiendo el mismo estado. Ahora mismo, `AuthContext` solo tiene **una** fuente de verdad: el listener `onAuthStateChanged`, que además espera a leer el perfil completo (con `role` incluido) desde Firestore antes de considerar que "hay sesión". Si `login`/`signup` llamaran `setUser` apenas Firebase confirma la autenticación, la UI podría mostrar una sesión "iniciada" con un `user` que todavía no tiene `role` (o con un valor optimista armado a mano), mientras en paralelo el listener sigue resolviendo el perfil real. Dependiendo del orden en que terminen esas dos actualizaciones, la última en llegar "gana" — pero no hay garantía de cuál es la última. En el peor caso, `AdminRoute` podría tomar una decisión de acceso basada en un `user` que todavía no pasó por la validación de Zod (`userDocSchema.parse`), es decir, sin ninguna garantía de que los datos sean correctos.

**¿Por qué ocultar el link al panel de administración en el Header no es suficiente para proteger esa ruta?**

Porque ocultar un link es una decisión que se toma **en el navegador del usuario**, con código que el usuario controla. Cualquiera puede escribir `/admin` directo en la barra de direcciones, sin pasar nunca por el `Header`. Peor aún: alguien con conocimientos técnicos mínimos puede abrir las DevTools y llamar a las funciones de Firestore directamente desde la consola, sin usar la UI de la app en absoluto. La única protección real de una ruta o de un dato es la que se evalúa en un lugar que el usuario no controla: `AdminRoute` (evaluado en cada render, así el usuario haya llegado por link o tipeando la URL) para la navegación, y `firestore.rules` (evaluado en el servidor de Firebase) para los datos en sí.

**¿Por qué es necesario el estado `loading` en `ProtectedRoute` y `AdminRoute`?**

Porque sin él, ambos guards tratarían el valor inicial `user: null` (que solo significa *"todavía no sabemos si hay sesión"*) como si fuera un `null` definitivo (*"no hay sesión"*), y redirigirían de más — exactamente lo que se demostró en el experimento de la sección 2. `loading` es la forma en la que `AuthContext` le dice al resto de la app *"esperá, todavía estoy averiguando"*, en vez de forzar una respuesta binaria (logueado / no logueado) antes de tener la información real.

**Tenés implementados los roles `customer` y `admin`. ¿Qué cambios habría que hacer para agregar un tercer rol `manager` que pueda acceder a `/admin` pero no a una hipotética ruta futura `/admin/settings`?**

1. **`src/types/user.ts`**: extender `userRoleSchema` a `z.enum(["customer", "admin", "manager"])`. Es el único lugar donde se define el conjunto de roles válidos.
2. **`src/routes/AdminRoute.tsx`**: hoy hace `if (user.role !== "admin")`, un chequeo de un solo rol fijo. Habría que generalizarlo para aceptar una lista de roles permitidos por ruta — por ejemplo, convertirlo en `RequireRole` parametrizable: `<Route element={<RequireRole roles={["admin", "manager"]} />}>` para `/admin`, y una instancia distinta `<Route element={<RequireRole roles={["admin"]} />}>` para `/admin/settings`. El componente pasaría de comparar `role !== "admin"` a comparar `!roles.includes(user.role)`.
3. **`firestore.rules`**: si `/admin/settings` en algún momento escribe datos sensibles (ej. configuración global de la tienda), las reglas de esa colección tendrían que validar el rol del usuario leyendo su documento en `users/{uid}` (con `get()` dentro de la regla), replicando ahí la misma restricción "solo admin, no manager" — otra vez, la protección de UI (`RequireRole`) no alcanza sola.
4. **`Header.tsx`**: si `manager` necesita ver el link al panel pero no a settings, el link a `/admin` pasaría de `user.role === "admin"` a `user.role === "admin" || user.role === "manager"`, y un eventual link a `/admin/settings` quedaría condicionado solo a `user.role === "admin"`.
5. **`docs/auth-notes.md` / tests**: documentar el nuevo rol y agregar los escenarios de test equivalentes a los que ya existen para `AdminRoute` (sin sesión → `/login`; `customer` → `/`; `manager` → accede a `/admin` pero no a `/admin/settings`; `admin` → accede a ambas).

## 5. Caso borde: usuario autenticado sin perfil en Firestore

Ver el comentario correspondiente en `src/contexts/AuthContext.tsx` (dentro del listener `onAuthStateChanged`, rama `if (!profile)`). Resumen:

- **Cuándo ocurre:** justo después de un `signup`, porque Firebase Auth confirma la cuenta nueva de inmediato y dispara `onAuthStateChanged`, mientras que el documento de perfil en Firestore (`createUserProfile`) se escribe en un paso posterior. Es una carrera entre dos sistemas distintos (Auth vs. Firestore).
- **Cómo se mitiga:** `getUserProfile` (en `usersService.ts`) reintenta la lectura hasta 3 veces con un backoff corto entre intentos antes de rendirse, dándole tiempo a que la escritura del perfil termine.
- **Qué pasa si el documento nunca aparece:** `AuthContext` trata la sesión como inválida (`user: null`) con un mensaje de error explícito, **sin asumir ningún rol por defecto**. No se fuerza un `signOut()` automático (para evitar una carrera contra el propio listener), pero es inofensivo: toda la lógica de autorización de la app (`ProtectedRoute`, `AdminRoute`, `Header`) depende de `user`, nunca de si Firebase tiene una sesión cruda activa.

### 5.1 Bug real encontrado y corregido: `createdAt` sin resolver justo después del signup

Durante la verificación manual de este homework (ver checklist del Paso 13) apareció un bug real: **después de crear una cuenta, el Header no reflejaba la sesión iniciada** — se quedaba mostrando "Iniciar sesión" indefinidamente, aunque Firebase Auth sí tenía la sesión guardada correctamente (confirmado inspeccionando IndexedDB directamente).

**Investigación (proceso de debugging sistemático, no prueba y error):**
1. Se descartó que fuera un problema de Firebase Auth: el usuario aparecía correctamente persistido en `IndexedDB` (`firebaseLocalStorageDb`), y un simple `reload()` de la página sí mostraba la sesión bien. El problema estaba en algún punto entre `onAuthStateChanged` y el render del `Header`.
2. Se agregó instrumentación temporal (`console.log`) en `AuthContext.tsx` y `usersService.ts` para trazar exactamente qué pasaba en cada paso — siguiendo el principio de "gather evidence" antes de proponer un fix.
3. El trace reveló: el documento en Firestore **sí existía** desde el primer intento de lectura (`exists=true`), pero `userDocSchema.parse(...)` tiraba un `ZodError` inmediatamente. Es decir: **no era una carrera de "documento inexistente"** (la hipótesis original, que motivó el backoff exponencial agregado antes de esta investigación) sino un error de validación.
4. Se confirmó el campo exacto: `raw.createdAt` llegaba como `undefined`, no como una instancia de `Timestamp`.
5. Se consultó la documentación del tipo `SnapshotOptions` del SDK instalado (`node_modules/@firebase/firestore/dist/index.d.ts`): *"Si se omite \[`serverTimestamps`\] o se pone en `'none'`, se devuelve `null` \[al campo\] hasta que el valor del servidor esté disponible"*.

**Causa raíz real:** `createUserProfile` escribe `createdAt: serverTimestamp()` — un *sentinel* local, no un valor real todavía. El **mismo cliente** que acaba de escribir ese documento (a través del listener `onAuthStateChanged`, que reacciona casi instantáneamente al alta de la cuenta) lo vuelve a leer con `getDoc()` **antes de que el servidor confirme la escritura**. Por default, Firestore devuelve ese campo como ausente hasta la confirmación — y como es un error de **parseo**, no de "documento no encontrado", la lógica de reintentos (pensada solo para el caso "todavía no existe") nunca se activaba: el error se propagaba en el primer intento, sin reintentar.

**Fix real:** en `getUserProfile` (`usersService.ts`), leer con `snapshot.data({ serverTimestamps: "estimate" })` en vez de `snapshot.data()` a secas. Con `"estimate"`, Firestore devuelve de inmediato un `Timestamp` estimado (basado en el reloj local) para cualquier `serverTimestamp()` todavía no confirmado, en vez de un campo ausente — eliminando la carrera de raíz en vez de esconderla detrás de más reintentos.

**Lección:** la hipótesis inicial (un problema de *timing* de red, solucionable con más reintentos y backoff exponencial) sonaba razonable y hasta parecía tener sentido con lo observado en las pestañas de Red del navegador, pero **nunca se verificó con evidencia directa antes de "arreglarla"** — el verdadero problema no era de tiempo, sino de qué valor devolvía Firestore para un campo todavía no confirmado. Solo instrumentando el código y mirando el valor real de cada campo apareció la causa verdadera. El backoff exponencial se mantuvo (con un budget más chico, 3 intentos) porque la carrera de "documento no encontrado" sigue siendo teóricamente posible, pero ya no es la que causaba el bug reportado.

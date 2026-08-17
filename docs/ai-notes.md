# Notas de uso de IA — Checkout + Orders end-to-end

Este documento deja evidencia de cómo se usó IA (Claude) durante el desarrollo: los cuatro prompts obligatorios del enunciado, un resumen de las respuestas, y **qué se aceptó, qué se rechazó y cómo se verificó cada cosa**.

La IA se usó como **auditora**, no como generadora de la solución completa. La diferencia se nota sobre todo en la última sección, donde se registran las veces que la IA se equivocó y cómo se detectó — porque una respuesta aceptada sin verificar no es una auditoría, es un acto de fe.

---

## Prompt 1 — Auditoría del modelo `Order` y riesgos de historial

**Prompt (copiado tal cual del enunciado):**
> Estoy implementando un modelo Order en Firestore con items como snapshot (name, priceAtPurchase, quantity). ¿Qué campos mínimos recomiendas para que el historial sea consistente y auditable? ¿Qué errores comunes ves si rehidrato desde products?

**Resumen de la respuesta:**

Campos mínimos recomendados: `userId` (dueño), `items[]` con la foto completa de cada producto, `total`, `status`, `createdAt` puesto por el servidor y `updatedAt` opcional.

Errores de rehidratar desde `products`:

| Riesgo | Qué pasa |
|---|---|
| El precio cambia | El historial muestra un importe distinto al que se cobró |
| El producto se elimina | La línea de la orden queda sin nombre ni precio, o directamente rota |
| El producto se renombra | La orden dice que se compró algo que el cliente nunca vio con ese nombre |
| Lecturas extra | Mostrar 20 órdenes de 3 ítems dispara 60 lecturas adicionales de `products` |

**Decisión: ACEPTADO.** El modelo de `src/types/order.ts` guarda exactamente esos campos. El nombre `priceAtPurchase` —y no `price`— es deliberado: dice que es el precio *de ese momento*.

**Verificación:** `src/services/orderConverter.test.ts` comprueba que el converter devuelva los ítems tal como se guardaron, sin consultar el catálogo. En el navegador se confirmó que el detalle de una orden muestra `$26.000` para un producto cuyo precio de catálogo podría cambiar después.

### El punto donde se rechazó el contrato del enunciado… y se aceptó igual

El proyecto anterior (L7) resolvía este mismo problema **al revés**: guardaba cada ítem como un documento propio en una subcolección `orders/{id}/items/{itemId}`, y **no guardaba el total**.

No era una decisión organizativa. Las reglas de Firestore **no pueden recorrer un array**, pero **sí pueden leer otros documentos con `get()`**. Con un documento por ítem, cada uno tenía su propia evaluación de regla, y ahí se podía comparar su precio contra el del catálogo:

```
request.resource.data.unitPrice == get(/products/$(productId)).data.price
```

Eso cerraba un agujero concreto: alguien que editara su `localStorage` no podía comprar más barato.

**El contrato de esta homework exige el modelo opuesto**, y es explícito en que no se negocia. Al volver a `items[]` embebidos, esa verificación **deja de ser posible**.

**Decisión: se adopta el modelo del enunciado, y se documenta el costo.** Las reglas siguen validando forma, tipos, cantidad de ítems y rangos, pero ya no pueden contrastar precios ni comprobar que `total` sea la suma de las líneas. Está escrito en tres lugares donde alguien lo va a leer: `src/types/order.ts`, `firestore.rules` y acá.

**Mitigación parcial aplicada:** el service **recalcula** el total a partir de los ítems en vez de copiar `cart.totalPrice`. No cierra el agujero —los precios de los ítems vienen del mismo lugar— pero elimina la incoherencia de guardar un total que no se corresponde con las líneas de la propia orden. Hay un test que lo fuerza: se le pasa un carrito cuyo `totalPrice` dice `999999` y se verifica que se guarde `250`.

---

## Prompt 2 — Revisión del flujo de checkout y casos borde

**Prompt (copiado tal cual del enunciado):**
> Revisa mi flujo de checkout (carrito → create order → confirmación). ¿Qué casos borde debería cubrir en UI (doble submit, errores de red, usuario no logueado, carrito vacío) y cómo debería comportarse?

**Resumen de la respuesta:**

1. **Doble submit**: deshabilitar el botón no alcanza. `disabled` depende de que React vuelva a renderizar, y eso ocurre *después* de que termina el manejador del evento; dos clics muy rápidos pueden dispararse ambos antes de ese re-render. Hace falta un segundo cerrojo con `useRef`, que se actualiza en el acto.
2. **Errores de red**: no vaciar el carrito, mostrar un mensaje entendible y permitir reintentar.
3. **Usuario no logueado / carrito vacío**: validar *antes* de tocar la red, para dar un mensaje específico en vez de un rechazo genérico de permisos.
4. **Efectos del éxito dentro del `try`**, nunca en el `finally`: en el `finally` se ejecutarían también cuando la creación falla, vaciándole el carrito a alguien cuya compra nunca se registró.
5. **Idempotencia**: generar el `orderId` antes de escribir y reutilizarlo en los reintentos, usando `setDoc` en vez de `addDoc`.

**Decisión: ACEPTADO en su totalidad.** Los puntos 1 a 4 ya venían del L7 y se conservaron. El punto 5 se implementó en esta homework (`createOrderId()` + `pendingOrderIdRef`).

**Verificación:** `CheckoutPage.test.tsx` cubre los cinco. El test del doble submit usa `fireEvent` dentro de un mismo `act()` y **no** `userEvent`, a propósito: `userEvent` espera a que React re-renderice entre clics, así que el segundo ya encontraría el botón deshabilitado y el test pasaría aunque no hubiera ninguna protección real.

### Un caso borde que la respuesta NO cubrió

La idempotencia con `setDoc` tiene una trampa que apareció al razonar el flujo completo, y que ninguna de las respuestas mencionó:

> Si el primer intento **sí se escribió** y lo que se perdió fue la respuesta (se cortó la red después del commit), el usuario ve un error y reintenta. Pero ese segundo `setDoc` sobre un documento que ya existe **deja de ser un `create` para las reglas y pasa a ser un `update`** — y el `update` solo lo puede hacer un administrador. El cliente recibiría `PERMISSION_DENIED` por una orden que en realidad se creó bien.

**Solución implementada:** ante un `permission-denied` en la creación, el service comprueba si el documento ya existe y pertenece al usuario; si es así, resuelve el intento como éxito. Se hace **dentro del `catch`** y no como chequeo previo, para no pagar una lectura extra en el camino feliz.

**Verificación:** tres tests en `ordersService.test.ts` cubren los tres escenarios: el documento ya existe y es suyo (éxito), no existe (se propaga el error), y existe pero es **de otro usuario** (se propaga). Ese último previene algo concreto: sin comprobar el `userId`, adivinar el id de una orden ajena haría que el checkout respondiera *"listo, tu compra está registrada"* mostrando el id de la compra de otra persona.

---

## Prompt 3 — Revisión de rules y posibles bypass

**Prompt (copiado tal cual del enunciado):**
> Estas son mis Firestore Rules para orders: owner read, admin read all, admin update solo status. ¿Qué bypass o fallas comunes hay? ¿Cómo puedo restringir updates por campo usando diff().affectedKeys()?

**Resumen de la respuesta:**

- **`keys()` no sirve para restringir un update.** `request.resource.data.keys()` describe el **documento final completo**, no el conjunto de cambios: con él habría que listar todos los campos de la orden y no se estaría restringiendo nada. Lo correcto es `request.resource.data.diff(resource.data).affectedKeys()`, que son los campos **efectivamente modificados**.
- **`hasOnly()` es preferible a `hasAny()` negado**: `hasOnly(['status','updatedAt'])` define una lista blanca, así que un campo nuevo que se agregue al documento en el futuro queda protegido por defecto.
- **Bypass típicos**: crear una orden a nombre de otro (`userId` sin comparar contra `request.auth.uid`), inyectar campos que la app no espera, insertar una orden ya marcada como completada, y falsear `createdAt` con una fecha del cliente en vez de `serverTimestamp()`.
- **Validar `createdAt == request.time`** es el patrón oficial para forzar que el campo venga del servidor.

**Decisión: ACEPTADO, y ampliado con tres cosas que la respuesta no mencionó.**

**1. El orden de las condiciones en `allow read` cuesta dinero.**

`isAdmin()` hace un `get()` sobre `users/{uid}`, y cada `get()` dentro de una regla es una **lectura facturable** —que se cobra incluso cuando la regla termina rechazando—. Las expresiones cortocircuitan, así que el orden importa:

```
// Con el dueño primero, un cliente que lista 20 órdenes NO dispara ningún get()
allow read: if isSignedIn() && (resource.data.userId == request.auth.uid || isAdmin());
```

Invertido, pagaría una lectura extra por cada documento del listado sin obtener nada a cambio.

**2. Validar la transición, no solo el valor.**

Restringir el update a `status` impide tocar otros campos, pero **no** impide pasar de `completed` de vuelta a `pending`. Las reglas replican la máquina de estados de `src/features/orders/orderTransitions.ts`. La duplicación es deliberada: deshabilitar la opción en el `<select>` ayuda al usuario honesto, pero no detiene a nadie que llame al SDK desde la consola del navegador.

**3. Exigir `updatedAt`, aunque el enunciado lo dé como opcional.**

Una orden que cambió de estado sin dejar constancia de cuándo es un registro peor que inútil para auditar. Las reglas exigen además que venga del servidor (`== request.time`).

**Verificación: 23 pruebas de caja negra, todas pasando.**

Se escribió `scripts/verificarReglas.ts` (`npm run verify:rules`) en vez de probar a mano una sola vez. Cubre los tres casos obligatorios del enunciado y veinte más. Resultado completo en [`verificacion-reglas.txt`](verificacion-reglas.txt).

**La decisión que sostiene todo el script:** usa el **SDK cliente**, no el de Admin. El SDK de Admin se saltea las reglas por diseño — con él, las 23 pruebas pasarían **sin verificar absolutamente nada**. Es el error que invalidaría el ejercicio entero, y está señalado en mayúsculas dentro del archivo.

### Un hallazgo del testeo en navegador

Al probar `/orders/un-id-que-no-existe` apareció `PERMISSION_DENIED`, no "no encontrada". La causa: en un `get` sobre un documento inexistente, `resource` es `null`, así que `resource.data.userId` no se puede evaluar y la regla deniega.

Eso es una propiedad de seguridad **deseable** —si "no existe" y "no es tuya" dieran errores distintos, alguien podría probar ids al azar y averiguar cuáles corresponden a órdenes reales—, pero el mensaje genérico le decía *"tu sesión expiró"* a quien simplemente tipeó mal la URL. Se corrigió con un mensaje que cubre las tres causas posibles sin confirmar ninguna.

---

## Prompt 4 — Revisión de queries e índices

**Prompt (copiado tal cual del enunciado):**
> Tengo queries en Firestore con where(userId==uid)+orderBy(createdAt desc) y where(status==X)+orderBy(createdAt desc). ¿Qué índices compuestos puedo necesitar y cómo diagnostico FAILED_PRECONDITION: requires an index?

**Resumen de la respuesta:**

- Hacen falta dos índices compuestos: `userId ASC + createdAt DESC` y `status ASC + createdAt DESC`.
- `FAILED_PRECONDITION` incluye un link directo que crea el índice en la consola. Tarda 1–2 minutos en construirse.
- **Versionar `firestore.indexes.json`**: un índice creado a mano desde el link vive **solo en ese proyecto de Firebase**. Sin versionarlo, producción falla con una consulta que en desarrollo funciona.
- **`orderBy` excluye en silencio** los documentos que no tengan ese campo: no hay error ni aviso, simplemente no aparecen. Una orden guardada sin `createdAt` desaparecería del historial y nadie se enteraría.

**Decisión: ACEPTADO en su totalidad.** Los dos índices están en `firestore.indexes.json` y se despliegan con `firebase deploy --only firestore:indexes`. El riesgo del `orderBy` se neutraliza en dos capas: el service siempre escribe `createdAt`, y las reglas **rechazan** cualquier orden que no lo traiga con `serverTimestamp()`.

**Ampliación:** se agregó un código de error propio `MISSING_INDEX`, separado de `UNKNOWN_ERROR`. Firestore lo reporta como `failed-precondition`, pero ese código cubre **otras** precondiciones sin relación, así que el mapeo comprueba **dos cosas**: el código *y* que el mensaje mencione `index`. Sin esa segunda verificación, un `failed-precondition` de otra causa mandaría el diagnóstico para el lado equivocado.

Se marca como **no reintentable** a propósito: el índice tarda un par de minutos, así que un reintento inmediato falla igual y ofrecer "Reintentar" produciría el mismo error en bucle.

**Verificación con el error real:** durante la prueba en navegador, la pantalla del historial mostró el mensaje de `MISSING_INDEX` mientras el índice se construía, y funcionó al terminar. El comportamiento se reprodujo tal cual lo describía la respuesta.

---

## Checklist de validación humana

El enunciado pide confirmar tres cosas antes de aceptar una respuesta de IA.

**¿Está alineado con la documentación oficial?**

Sí, y en dos puntos se consultó la documentación **antes** de escribir el código, no después:

- **`FirestoreDataConverter`**: se confirmó en el código del SDK (`firebase-js-sdk`, `user_data_writer.ts`) que el SDK modular **siempre** devuelve `Timestamp` y que la vieja opción `timestampsInSnapshots` fue eliminada. Eso convirtió el converter de "sugerencia del enunciado" en requisito real.
- **`SnapshotOptions.serverTimestamps`**: la documentación dice que el valor por defecto (`'none'`) devuelve **`null`** para un `serverTimestamp()` pendiente. Sin ese dato, el converter habría fallado al leer una orden recién creada.

**¿Compila con los tipos y encaja con la arquitectura?**

Sí. `tsc` y `eslint` en cero, sin un solo `any`. La separación **UI → Context → Service → Firestore** se respeta: ninguna página importa el SDK de Firestore.

Dos ajustes concretos que impuso el `tsconfig` heredado y que ninguna respuesta anticipó:

- `exactOptionalPropertyTypes` obliga a **omitir** `updatedAt` cuando no existe, en vez de asignarle `undefined`. De ahí el spread condicional del converter.
- `erasableSyntaxOnly` prohíbe los *parameter properties* (`constructor(readonly x: number)`), que hubo que reescribir en un mock.

**¿Se probó de verdad?**

Sí, en tres niveles:

| Nivel | Qué cubre |
|---|---|
| 519 tests automatizados | Lógica pura, service con Firebase mockeado, y las pantallas |
| 23 pruebas de reglas | Contra Firestore **real**, con el SDK cliente |
| Verificación en navegador | Flujo completo customer y admin con Chrome DevTools |

---

## Dónde la IA se equivocó

Esta sección existe porque una auditoría que solo registra aciertos no es una auditoría. Todos estos errores los cometió la IA durante el desarrollo y se detectaron verificando.

**1. Diagnóstico inválido buscando en el lugar equivocado.**

Al investigar por qué el logout parecía no funcionar, se buscó la sesión en `localStorage` y no se encontró nada, y se concluyó que el logout había funcionado. La conclusión era inválida: **Firebase Auth persiste en IndexedDB** (`firebaseLocalStorageDb`), no en `localStorage`. Buscar en el lugar equivocado y no encontrar nada no prueba nada. El problema real era otro: el clic del automatizador no llegaba a React.

**2. Búsqueda de secretos con un falso positivo, y después con un falso negativo.**

Un `grep` de `BEGIN PRIVATE KEY` sobre los archivos rastreados dio dos coincidencias que resultaron ser **documentación sobre la búsqueda de secretos**, no secretos. Al corregirlo, el segundo intento capturó un fragmento vacío y `grep -F ""` coincidió con los 121 archivos.

Lo que resolvió las dos cosas fue la **contraprueba**: confirmar que el método encuentra el fragmento donde sí debe estar. Sin eso, un "0 coincidencias" no distingue entre *"no hay secretos"* y *"mi búsqueda está rota"*.

**3. Un "lint OK" que no dependía del resultado del lint.**

Se reportó el lint en verde cuando en realidad tenía un error. El comando terminaba en `&& echo "lint OK"` después de un `tail`, que siempre tiene éxito, así que el mensaje se imprimía pasara lo que pasara. Un chequeo cuyo resultado no depende de lo que chequea es peor que no tenerlo, porque da confianza falsa.

**4. Una predicción equivocada sobre cuándo volvería a compilar el proyecto.**

Se anunció que el proyecto compilaría al terminar la Etapa 2. No fue así: faltaba actualizar el checkout, que era la Etapa 3.

**5. Impaciencia interpretada como bug.**

El historial fallaba con `MISSING_INDEX` y se reintentó varias veces sospechando un problema de código. No lo había: el índice simplemente estaba tardando ~2 minutos en construirse, exactamente como decía la documentación. Se confirmó reproduciendo la consulta desde Node, que funcionó apenas el índice estuvo listo.

---

## Decisiones tomadas sin consultar a la IA

Para dejar clara la frontera de lo que se delegó:

- **Usar un proyecto de Firebase nuevo** en lugar de reutilizar el del L7, para no romper su despliegue en producción al cambiar las reglas de `orders`.
- **Una sola rama** con un commit por etapa y un único PR, en vez de una rama por etapa: varias etapas no compilan solas, así que habría PRs con el CI en rojo.
- **Adelantar la reescritura de los tests del service**, planificada para el final. Con el archivo roto el build fallaba, y mientras hay errores conocidos no se puede distinguir un error nuevo de los que ya estaban.
- **Confirmar todos los cambios de estado en el panel de administración**, no solo las cancelaciones: en esta máquina de estados ninguna transición se puede deshacer.

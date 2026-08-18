---
name: verify
description: Cómo levantar y recorrer esta app para verificar cambios en el navegador. Usar al validar una feature o un fix de este repo.
---

# Verificar esta app

E-commerce React + Vite + Firebase (Firestore + Auth). La verificación real es
en el navegador: los tests mockean Firestore, así que **no tocan las reglas de
seguridad ni el comportamiento de red**, que es donde aparecen los problemas.

## Levantar

```bash
npm run dev          # http://localhost:5173  (dejar corriendo en otra terminal)
```

Necesita `.env` con las 6 `VITE_FIREBASE_*`. Las reglas tienen que estar
desplegadas o hasta el registro de usuarios falla:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

## Cuentas de prueba

Las credenciales viven en `.env`, en `TEST_CUSTOMER_EMAIL` / `TEST_CUSTOMER_PASSWORD`
y `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD` — nunca acá. Este archivo se
commitea, y una contraseña escrita en un archivo del repositorio es mala
costumbre incluso cuando la cuenta es descartable.

El rol de administrador se setea a mano en Firestore Console: las reglas
prohíben que un usuario cambie su propio `role`.

## Conducir con Chrome DevTools MCP

**El clic del automatizador no siempre llega a React** — sobre todo en botones
del header. Si un clic "exitoso" no produce efecto, usar `.click()` nativo desde
`evaluate_script`.

Para escribir en inputs controlados hay que usar el setter nativo, o React no
registra el cambio:

```js
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
setter.call(input, valor);
input.dispatchEvent(new Event('input', { bubbles: true }));
```

**`CartProvider` lee `localStorage` una sola vez al montar.** Escribir el
carrito y navegar con `pushState` no lo relee: hay que usar `location.href`.

## Flujos que conviene recorrer

1. **Guards**: sin sesión, `/checkout` `/orders` `/orders/:id` `/admin`
   `/admin/orders` → `/login`. Con sesión de customer, `/admin` → `/`.
2. **Compra**: agregar al carrito → `/checkout` → confirmar → detalle.
3. **Precio del catálogo**: cambiar el precio de un producto con el SDK de Admin
   y comprobar que (a) el historial NO cambia y (b) un carrito con el precio
   viejo es rechazado por las reglas.
4. **Sin conexión**: `emulate` con `Offline`. `setDoc` NO rechaza — encola. A
   los 8s tiene que aparecer el aviso de demora.
5. **Admin**: filtro por estado, cambio con confirmación, estado terminal.
6. **Reglas**: `npm run verify:rules` (28 pruebas contra Firestore real, se
   limpia sola).

## Trampas conocidas

- Un índice compuesto nuevo tarda **1–2 minutos** en construirse; mientras tanto
  la consulta falla y parece un bug del código.
- `documentElement.scrollWidth` reporta el ancho del contenido de contenedores
  con scroll: **no** indica scroll horizontal real. Comprobarlo con
  `window.scrollTo(500,0)` y mirar `scrollX`.
- La caché de Firestore es **en memoria**: una escritura encolada sin red se
  pierde al recargar.

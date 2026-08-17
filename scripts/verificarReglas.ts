import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut, type Auth } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { z } from "zod";
import { envSchema } from "../src/lib/envSchema.js";

// ============================================================================
// PRUEBAS DE CAJA NEGRA DE LAS REGLAS DE FIRESTORE
// ============================================================================
//
// El enunciado marca como OBLIGATORIO verificar tres comportamientos: que un
// cliente no pueda leer una orden ajena, que un administrador pueda cambiar el
// estado, y que NO pueda tocar otros campos. Este script los ejecuta —junto con
// varios casos más— y deja el resultado impreso.
//
// ⚠ USA EL SDK CLIENTE, NO EL DE ADMIN, Y ESO ES TODO EL PUNTO.
//
// El SDK de Admin (el que usa scripts/seed.ts) se salta las reglas por diseño:
// con él, TODAS estas pruebas pasarían y no se estaría verificando nada. El SDK
// cliente se autentica como un usuario real y queda sujeto a las mismas reglas
// que el navegador, así que lo que se mide acá es exactamente lo que le pasaría
// a alguien manipulando la aplicación desde la consola del navegador.
//
// Se corre con:  npm run verify:rules
// ============================================================================

process.loadEnvFile(".env");

const scriptEnvSchema = envSchema.extend({
  TEST_CUSTOMER_EMAIL: z.string().min(1, "Falta TEST_CUSTOMER_EMAIL en .env"),
  TEST_CUSTOMER_PASSWORD: z.string().min(1, "Falta TEST_CUSTOMER_PASSWORD en .env"),
  TEST_ADMIN_EMAIL: z.string().min(1, "Falta TEST_ADMIN_EMAIL en .env"),
  TEST_ADMIN_PASSWORD: z.string().min(1, "Falta TEST_ADMIN_PASSWORD en .env"),
});

const env = scriptEnvSchema.parse(process.env);

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
});

const auth: Auth = getAuth(app);
const db: Firestore = getFirestore(app);

const ORDERS = "orders";

let pruebasCorridas = 0;
let pruebasFallidas = 0;

/**
 * Ejecuta una operación y comprueba si fue permitida o rechazada, según lo esperado.
 *
 * @param descripcion   qué se está probando, en palabras.
 * @param seEspera      "permitido" si la operación debe funcionar, "rechazado" si no.
 * @param operacion     la operación contra Firestore.
 *
 * No corta la ejecución ante un fallo: interesa el informe completo, no el
 * primer problema. El código de salida al final refleja si hubo alguno.
 */
async function comprobar(
  descripcion: string,
  seEspera: "permitido" | "rechazado",
  operacion: () => Promise<unknown>,
): Promise<void> {
  pruebasCorridas += 1;

  let resultado: "permitido" | "rechazado";
  let detalle = "";

  try {
    await operacion();
    resultado = "permitido";
  } catch (error) {
    resultado = "rechazado";
    detalle = error instanceof Error ? ` (${error.message.slice(0, 60)}…)` : "";
  }

  const paso = resultado === seEspera;

  if (!paso) {
    pruebasFallidas += 1;
  }

  const marca = paso ? "OK  " : "FALLA";
  console.log(`${marca} | esperado: ${seEspera.padEnd(10)} | real: ${resultado.padEnd(10)} | ${descripcion}`);

  if (!paso && detalle) {
    console.log(`      ${detalle}`);
  }
}

/** Crea una orden mínima para el usuario en sesión y devuelve su id. */
async function crearOrdenDePrueba(userId: string): Promise<string> {
  const referencia = doc(collection(db, ORDERS));

  await setDoc(referencia, {
    userId,
    items: [{ productId: "prueba", name: "Producto de prueba", priceAtPurchase: 100, quantity: 1 }],
    total: 100,
    status: "pending",
    createdAt: serverTimestamp(),
  });

  return referencia.id;
}

async function main(): Promise<void> {
  console.log("Verificación de las reglas de Firestore\n");

  // -------------------------------------------------------------------------
  // Preparación: una orden por usuario, para poder probar accesos cruzados
  // -------------------------------------------------------------------------
  const customer = await signInWithEmailAndPassword(
    auth,
    env.TEST_CUSTOMER_EMAIL,
    env.TEST_CUSTOMER_PASSWORD,
  );
  const ordenDelCustomer = await crearOrdenDePrueba(customer.user.uid);

  await signOut(auth);

  const admin = await signInWithEmailAndPassword(
    auth,
    env.TEST_ADMIN_EMAIL,
    env.TEST_ADMIN_PASSWORD,
  );
  const ordenDelAdmin = await crearOrdenDePrueba(admin.user.uid);

  await signOut(auth);

  // -------------------------------------------------------------------------
  console.log("\n--- COMO CLIENTE ---");
  await signInWithEmailAndPassword(auth, env.TEST_CUSTOMER_EMAIL, env.TEST_CUSTOMER_PASSWORD);

  await comprobar("lee su propia orden", "permitido", () =>
    getDoc(doc(db, ORDERS, ordenDelCustomer)),
  );

  // El caso obligatorio nº 1 del enunciado.
  await comprobar("lee una orden AJENA", "rechazado", () =>
    getDoc(doc(db, ORDERS, ordenDelAdmin)),
  );

  await comprobar("lista sus órdenes filtrando por su uid", "permitido", () =>
    getDocs(
      query(
        collection(db, ORDERS),
        where("userId", "==", customer.user.uid),
        orderBy("createdAt", "desc"),
      ),
    ),
  );

  // Sin el where por userId, la consulta devolvería órdenes de otros: Firestore
  // evalúa la regla contra cada documento y la rechaza entera.
  await comprobar("lista TODAS las órdenes, sin filtrar por su uid", "rechazado", () =>
    getDocs(query(collection(db, ORDERS), orderBy("createdAt", "desc"))),
  );

  await comprobar("cambia el estado de su propia orden", "rechazado", () =>
    updateDoc(doc(db, ORDERS, ordenDelCustomer), {
      status: "completed",
      updatedAt: serverTimestamp(),
    }),
  );

  await comprobar("crea una orden a nombre de OTRO usuario", "rechazado", () =>
    setDoc(doc(collection(db, ORDERS)), {
      userId: admin.user.uid,
      items: [{ productId: "x", name: "x", priceAtPurchase: 1, quantity: 1 }],
      total: 1,
      status: "pending",
      createdAt: serverTimestamp(),
    }),
  );

  await comprobar("crea una orden ya marcada como completada", "rechazado", () =>
    setDoc(doc(collection(db, ORDERS)), {
      userId: customer.user.uid,
      items: [{ productId: "x", name: "x", priceAtPurchase: 1, quantity: 1 }],
      total: 1,
      status: "completed",
      createdAt: serverTimestamp(),
    }),
  );

  await comprobar("crea una orden con un campo inventado", "rechazado", () =>
    setDoc(doc(collection(db, ORDERS)), {
      userId: customer.user.uid,
      items: [{ productId: "x", name: "x", priceAtPurchase: 1, quantity: 1 }],
      total: 1,
      status: "pending",
      createdAt: serverTimestamp(),
      descuentoSecreto: 100,
    }),
  );

  await comprobar("crea una orden con fecha propia en vez de la del servidor", "rechazado", () =>
    setDoc(doc(collection(db, ORDERS)), {
      userId: customer.user.uid,
      items: [{ productId: "x", name: "x", priceAtPurchase: 1, quantity: 1 }],
      total: 1,
      status: "pending",
      createdAt: new Date("2020-01-01"),
    }),
  );

  await comprobar("borra su propia orden", "rechazado", () =>
    // deleteDoc se importa dinámicamente para no sumarlo arriba solo por esta
    // línea; el resultado es el mismo.
    import("firebase/firestore").then(({ deleteDoc }) =>
      deleteDoc(doc(db, ORDERS, ordenDelCustomer)),
    ),
  );

  await signOut(auth);

  // -------------------------------------------------------------------------
  console.log("\n--- COMO ADMINISTRADOR ---");
  await signInWithEmailAndPassword(auth, env.TEST_ADMIN_EMAIL, env.TEST_ADMIN_PASSWORD);

  await comprobar("lee una orden de otro usuario", "permitido", () =>
    getDoc(doc(db, ORDERS, ordenDelCustomer)),
  );

  await comprobar("lista TODAS las órdenes sin filtro", "permitido", () =>
    getDocs(query(collection(db, ORDERS), orderBy("createdAt", "desc"))),
  );

  await comprobar("filtra por estado", "permitido", () =>
    getDocs(
      query(collection(db, ORDERS), where("status", "==", "pending"), orderBy("createdAt", "desc")),
    ),
  );

  // El caso obligatorio nº 2 del enunciado.
  await comprobar("cambia el estado con una transición válida", "permitido", () =>
    updateDoc(doc(db, ORDERS, ordenDelCustomer), {
      status: "processing",
      updatedAt: serverTimestamp(),
    }),
  );

  // El caso obligatorio nº 3 del enunciado, en sus tres variantes.
  await comprobar("cambia SOLO el total", "rechazado", () =>
    updateDoc(doc(db, ORDERS, ordenDelCustomer), { total: 1 }),
  );

  await comprobar("cambia el total JUNTO CON el estado", "rechazado", () =>
    updateDoc(doc(db, ORDERS, ordenDelCustomer), {
      status: "completed",
      total: 1,
      updatedAt: serverTimestamp(),
    }),
  );

  await comprobar("cambia el userId (se apropia de la orden)", "rechazado", () =>
    updateDoc(doc(db, ORDERS, ordenDelCustomer), {
      userId: admin.user.uid,
      updatedAt: serverTimestamp(),
    }),
  );

  await comprobar("cambia los ítems de la compra", "rechazado", () =>
    updateDoc(doc(db, ORDERS, ordenDelCustomer), {
      items: [{ productId: "x", name: "x", priceAtPurchase: 0, quantity: 1 }],
      updatedAt: serverTimestamp(),
    }),
  );

  await comprobar("hace una transición inválida (processing → pending)", "rechazado", () =>
    updateDoc(doc(db, ORDERS, ordenDelCustomer), {
      status: "pending",
      updatedAt: serverTimestamp(),
    }),
  );

  await comprobar("pone updatedAt con una fecha propia", "rechazado", () =>
    updateDoc(doc(db, ORDERS, ordenDelCustomer), {
      status: "completed",
      updatedAt: new Date("2020-01-01"),
    }),
  );

  await comprobar("borra una orden", "rechazado", () =>
    import("firebase/firestore").then(({ deleteDoc }) =>
      deleteDoc(doc(db, ORDERS, ordenDelCustomer)),
    ),
  );

  await comprobar("lleva la orden a un estado terminal", "permitido", () =>
    updateDoc(doc(db, ORDERS, ordenDelCustomer), {
      status: "completed",
      updatedAt: serverTimestamp(),
    }),
  );

  await comprobar("saca la orden de un estado terminal", "rechazado", () =>
    updateDoc(doc(db, ORDERS, ordenDelCustomer), {
      status: "processing",
      updatedAt: serverTimestamp(),
    }),
  );

  await signOut(auth);

  // -------------------------------------------------------------------------
  console.log(`\n${pruebasCorridas} pruebas — ${pruebasFallidas} fallaron`);
  console.log(`\nÓrdenes de prueba creadas (se pueden borrar desde la consola):`);
  console.log(`  ${ordenDelCustomer}  (del cliente)`);
  console.log(`  ${ordenDelAdmin}  (del administrador)`);

  // Código de salida distinto de cero si algo falló: así el resultado sirve
  // también desde un pipeline, no solo mirándolo.
  process.exit(pruebasFallidas === 0 ? 0 : 1);
}

await main();

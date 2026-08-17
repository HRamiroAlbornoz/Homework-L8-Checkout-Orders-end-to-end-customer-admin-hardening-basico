import { FirebaseError, initializeApp } from "firebase/app";
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
  limit,
  type Firestore,
} from "firebase/firestore";
import { cert, deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import { envSchema } from "../src/lib/envSchema.js";
import { loadServiceAccount } from "./serviceAccount.js";

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
  // Hace falta para BORRAR las órdenes de prueba al terminar. Las reglas
  // prohíben el delete desde el cliente —una orden es un registro histórico—,
  // así que sin el SDK de Admin quedarían para siempre en la base, ensuciando
  // el historial real del cliente y el panel de administración.
  FIREBASE_SERVICE_ACCOUNT_JSON: z
    .string()
    .min(1, "Falta FIREBASE_SERVICE_ACCOUNT_JSON en .env (se usa para limpiar las órdenes de prueba)"),
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

// Ids de TODAS las órdenes que crea el script, para poder borrarlas al terminar.
//
// Es una lista y no dos variables sueltas porque algunas pruebas crean órdenes
// además de las dos de preparación —por ejemplo, la que comprueba el límite de
// las reglas con los arrays—. Con variables sueltas, cada prueba nueva que
// escriba algo se olvidaría de limpiarlo y la base se iría ensuciando de a poco.
const ordenesACancelar: string[] = [];

/**
 * Resultado observable de una operación.
 *
 * "rechazado" significa específicamente que LAS REGLAS la denegaron. Cualquier
 * otro fallo es "fallo-inesperado" y NO cuenta como verificación.
 */
type Resultado = "permitido" | "rechazado" | "fallo-inesperado";

/**
 * Ejecuta una operación y comprueba si fue permitida o rechazada, según lo esperado.
 *
 * @param descripcion   qué se está probando, en palabras.
 * @param seEspera      "permitido" si la operación debe funcionar, "rechazado" si no.
 * @param operacion     la operación contra Firestore.
 *
 * ⚠ POR QUÉ NO ALCANZA CON "HUBO EXCEPCIÓN = FUE RECHAZADO"
 *
 * Una versión anterior de esta función daba por buena cualquier excepción. Con
 * ese criterio, una prueba que espera un rechazo pasaba también si se caía la
 * red, si faltaba un índice o si había un error de tipeo en el propio script —
 * y el informe decía "23 de 23" sin haber comprobado una sola regla.
 *
 * Ese es exactamente el error que este script existe para no cometer: un
 * chequeo cuyo resultado no depende de lo que chequea da confianza falsa, que
 * es peor que no tener chequeo.
 *
 * Por eso solo se cuenta como "rechazado" un FirebaseError con código
 * "permission-denied", que es el que emiten las reglas. Todo lo demás se marca
 * como fallo inesperado, se imprime con su causa y hace fallar el script.
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

  let resultado: Resultado;
  let detalle = "";

  try {
    await operacion();
    resultado = "permitido";
  } catch (error) {
    if (error instanceof FirebaseError && error.code === "permission-denied") {
      resultado = "rechazado";
    } else {
      resultado = "fallo-inesperado";
      detalle =
        error instanceof Error ? `${error.name}: ${error.message}` : `valor lanzado: ${String(error)}`;
    }
  }

  const paso = resultado === seEspera;

  if (!paso) {
    pruebasFallidas += 1;
  }

  const marca = paso ? "OK  " : "FALLA";
  console.log(
    `${marca} | esperado: ${seEspera.padEnd(10)} | real: ${resultado.padEnd(16)} | ${descripcion}`,
  );

  if (!paso && detalle) {
    console.log(`       causa: ${detalle}`);
  }
}

/**
 * Borra las órdenes creadas por esta corrida.
 *
 * @param ids  ids de las órdenes de prueba.
 *
 * Usa el SDK de ADMIN, y no el cliente, porque las reglas prohíben el delete a
 * cualquiera: una orden es un registro histórico y no se borra desde la
 * aplicación. Esa misma regla —correcta— haría que estas órdenes de prueba
 * quedaran para siempre en la base, contaminando el historial real del cliente
 * y el panel de administración con datos falsos.
 *
 * Es la única parte del script que se saltea las reglas, y es a propósito: acá
 * no se está verificando nada, se está limpiando.
 */
async function limpiarOrdenesDePrueba(ids: string[]): Promise<void> {
  const adminApp = initializeAdminApp(
    { credential: cert(loadServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON)) },
    // Nombre propio para no chocar con ninguna otra app ya inicializada.
    "limpieza-verificacion-reglas",
  );

  try {
    const adminDb = getAdminFirestore(adminApp);

    await Promise.all(ids.map((id) => adminDb.collection(ORDERS).doc(id).delete()));

    console.log(`\nÓrdenes de prueba eliminadas: ${ids.length}`);
  } finally {
    // Sin esto, el proceso queda vivo esperando a que la conexión del SDK de
    // Admin se cierre sola.
    await deleteAdminApp(adminApp);
  }
}

interface ProductoDeCatalogo {
  id: string;
  name: string;
  price: number;
}

/**
 * Trae un producto real del catálogo.
 *
 * @returns  id, nombre y precio de un producto existente.
 * @throws   Error con un mensaje accionable si el catálogo está vacío.
 *
 * Hace falta porque las reglas ahora verifican el precio de cada ítem contra
 * `products/{productId}` con un get(). Un productId inventado hace fallar ese
 * get() y la orden se rechaza — que es exactamente lo que se busca, pero
 * significa que las órdenes de prueba tienen que usar datos reales del catálogo.
 */
async function obtenerProductoDelCatalogo(): Promise<ProductoDeCatalogo> {
  const resultado = await getDocs(query(collection(db, "products"), limit(1)));
  const documento = resultado.docs[0];

  if (!documento) {
    throw new Error(
      "El catálogo está vacío, así que no se puede armar una orden válida.\n" +
        "Corré `npm run seed` antes de verificar las reglas.",
    );
  }

  const datos = documento.data();

  if (typeof datos.price !== "number" || typeof datos.name !== "string") {
    throw new Error(`El producto ${documento.id} no tiene un precio o un nombre utilizables.`);
  }

  return { id: documento.id, name: datos.name, price: datos.price };
}

/** Crea una orden VÁLIDA para el usuario en sesión y devuelve su id. */
async function crearOrdenDePrueba(userId: string, producto: ProductoDeCatalogo): Promise<string> {
  const referencia = doc(collection(db, ORDERS));

  await setDoc(referencia, {
    userId,
    items: [
      {
        productId: producto.id,
        name: producto.name,
        // El precio real del catálogo: cualquier otro valor sería rechazado.
        priceAtPurchase: producto.price,
        quantity: 1,
      },
    ],
    total: producto.price,
    status: "pending",
    createdAt: serverTimestamp(),
  });

  ordenesACancelar.push(referencia.id);

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

  // Las órdenes de prueba tienen que usar un producto REAL: las reglas
  // comparan el precio de cada ítem contra el catálogo, así que un productId
  // inventado se rechaza.
  const producto = await obtenerProductoDelCatalogo();
  console.log(`Producto usado en las pruebas: ${producto.name} ($ ${producto.price})\n`);

  const ordenDelCustomer = await crearOrdenDePrueba(customer.user.uid, producto);

  await signOut(auth);

  const admin = await signInWithEmailAndPassword(
    auth,
    env.TEST_ADMIN_EMAIL,
    env.TEST_ADMIN_PASSWORD,
  );
  const ordenDelAdmin = await crearOrdenDePrueba(admin.user.uid, producto);

  await signOut(auth);

  // A partir de acá las órdenes de prueba YA EXISTEN, así que todo lo que sigue
  // va dentro de un try/finally: la limpieza tiene que ocurrir aunque una
  // prueba falle o el script se rompa a mitad de camino. Sin eso, cada corrida
  // con problemas dejaría dos órdenes más contaminando la base — y son
  // imposibles de borrar desde el cliente.
  try {
    await ejecutarPruebas(
      customer.user.uid,
      admin.user.uid,
      ordenDelCustomer,
      ordenDelAdmin,
      producto,
    );
  } finally {
    await limpiarOrdenesDePrueba(ordenesACancelar);
  }

  console.log(`\n${pruebasCorridas} pruebas — ${pruebasFallidas} fallaron`);

  // Código de salida distinto de cero si algo falló: así el resultado sirve
  // también desde un pipeline, no solo mirándolo.
  process.exit(pruebasFallidas === 0 ? 0 : 1);
}

/**
 * Las pruebas propiamente dichas.
 *
 * @param uidCustomer      uid del cliente.
 * @param uidAdmin         uid del administrador.
 * @param ordenDelCustomer id de la orden de prueba del cliente.
 * @param ordenDelAdmin    id de la orden de prueba del administrador.
 * @param producto         producto real del catálogo, con su precio verdadero.
 */
async function ejecutarPruebas(
  uidCustomer: string,
  uidAdmin: string,
  ordenDelCustomer: string,
  ordenDelAdmin: string,
  producto: ProductoDeCatalogo,
): Promise<void> {
  /** Una línea de orden con el precio correcto del catálogo. */
  const lineaValida = {
    productId: producto.id,
    name: producto.name,
    priceAtPurchase: producto.price,
    quantity: 1,
  };
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
        where("userId", "==", uidCustomer),
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
      userId: uidAdmin,
      items: [lineaValida],
      total: producto.price,
      status: "pending",
      createdAt: serverTimestamp(),
    }),
  );

  await comprobar("crea una orden ya marcada como completada", "rechazado", () =>
    setDoc(doc(collection(db, ORDERS)), {
      userId: uidCustomer,
      items: [lineaValida],
      total: producto.price,
      status: "completed",
      createdAt: serverTimestamp(),
    }),
  );

  await comprobar("crea una orden con un campo inventado", "rechazado", () =>
    setDoc(doc(collection(db, ORDERS)), {
      userId: uidCustomer,
      items: [lineaValida],
      total: producto.price,
      status: "pending",
      createdAt: serverTimestamp(),
      descuentoSecreto: 100,
    }),
  );

  await comprobar("crea una orden con fecha propia en vez de la del servidor", "rechazado", () =>
    setDoc(doc(collection(db, ORDERS)), {
      userId: uidCustomer,
      items: [lineaValida],
      total: producto.price,
      status: "pending",
      createdAt: new Date("2020-01-01"),
    }),
  );

  // ---------------------------------------------------------------------
  // VERIFICACIÓN DEL PRECIO CONTRA EL CATÁLOGO
  // ---------------------------------------------------------------------
  //
  // Estas cinco pruebas cubren el agujero más grave que tuvo el proyecto: sin
  // ellas, cualquier cliente podía escribir su propio precio desde la consola
  // del navegador y comprar a lo que quisiera.
  //
  // Las reglas lo cierran validando cada posición del array por índice, que es
  // lo que la documentación oficial recomienda cuando no se puede iterar.

  await comprobar("compra a un precio inventado, más barato que el del catálogo", "rechazado", () =>
    setDoc(doc(collection(db, ORDERS)), {
      userId: uidCustomer,
      items: [{ ...lineaValida, priceAtPurchase: 0.01 }],
      total: 0.01,
      status: "pending",
      createdAt: serverTimestamp(),
    }),
  );

  await comprobar("declara un total que no coincide con sus líneas", "rechazado", () =>
    setDoc(doc(collection(db, ORDERS)), {
      userId: uidCustomer,
      items: [{ ...lineaValida, quantity: 5 }],
      // Debería ser precio × 5.
      total: producto.price,
      status: "pending",
      createdAt: serverTimestamp(),
    }),
  );

  await comprobar("compra un producto que no existe en el catálogo", "rechazado", () =>
    setDoc(doc(collection(db, ORDERS)), {
      userId: uidCustomer,
      items: [{ ...lineaValida, productId: "producto-inexistente-123" }],
      total: producto.price,
      status: "pending",
      createdAt: serverTimestamp(),
    }),
  );

  // Antes de la corrección, esta escritura era ACEPTADA: las reglas solo
  // comprobaban que "items" fuera una lista de tamaño razonable. El documento
  // resultante rompía la validación al leerlo, y como las órdenes no se pueden
  // borrar, dejaba el historial y el panel inutilizables de forma permanente.
  await comprobar("crea una orden con items que no son objetos", "rechazado", () =>
    setDoc(doc(collection(db, ORDERS)), {
      userId: uidCustomer,
      items: [1, 2, 3],
      total: 1,
      status: "pending",
      createdAt: serverTimestamp(),
    }),
  );

  // El tope de 10 no es una preferencia: es el máximo de llamadas a get() que
  // Firestore permite por request de un solo documento, y las reglas gastan una
  // por ítem para verificar su precio.
  await comprobar("crea una orden con más ítems de los que las reglas pueden verificar", "rechazado", () =>
    setDoc(doc(collection(db, ORDERS)), {
      userId: uidCustomer,
      items: Array.from({ length: 11 }, () => lineaValida),
      total: producto.price * 11,
      status: "pending",
      createdAt: serverTimestamp(),
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
      userId: uidAdmin,
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
}

await main();

import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { userDocSchema, type UserProfile } from "../types/user";

// No se usa FirestoreDataConverter acá (a diferencia de productsService.ts):
// createUserProfile escribe un serverTimestamp() (un "sentinel" del SDK, no un
// Timestamp real todavía) mientras que getUserProfile lee un Timestamp ya
// resuelto. Un converter único para lectura y escritura mentiría sobre uno de
// los dos tipos, así que cada función valida/arma su propia forma por separado.

const PROFILE_READ_MAX_ATTEMPTS = 3;
const PROFILE_READ_BASE_DELAY_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Lee el perfil de "users/{uid}".
//
// Dos carreras distintas pueden ocurrir justo después de un signup, y esta
// función resuelve las DOS:
//
// 1) El documento todavía no existe: createUserWithEmailAndPassword confirma
//    la sesión de inmediato y dispara onAuthStateChanged, pero createUserProfile
//    (el setDoc del perfil) puede no haber terminado. Para esto reintentamos
//    con un backoff corto.
// 2) El documento YA existe pero "createdAt" todavía no se resolvió: como
//    createUserProfile escribe createdAt con serverTimestamp() (un sentinel,
//    no un Timestamp real todavía), el MISMO cliente que acaba de escribir el
//    documento puede leerlo de vuelta antes de que el servidor confirme esa
//    escritura. Por default Firestore devuelve ese campo como ausente
//    ("undefined"/"null") hasta la confirmación (ver SnapshotOptions.serverTimestamps
//    en la documentación del SDK) — por eso NUNCA usamos snapshot.data() a
//    secas acá: pedimos "estimate", que devuelve de inmediato un Timestamp
//    estimado con el reloj local en vez de un campo ausente. Esto elimina la
//    carrera de raíz, en vez de solo esconderla detrás de más reintentos (un
//    error de validación de Zod, a diferencia de un documento inexistente, no
//    es algo que valga la pena reintentar: seguiría fallando igual si
//    volviéramos a pedir snapshot.data() sin la opción "estimate").
//
// Si tras agotar los reintentos el documento sigue sin existir, se devuelve
// null: quien llama decide qué hacer, nunca se asume un rol por defecto acá.
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  // El try/catch vive DENTRO del loop, por intento: si getDoc() falla por un
  // problema transitorio de red en el intento 2, eso no debe abortar la
  // función entera sin probar el intento 3. Se guarda el último error visto
  // ("lastError") y recién se relanza si se agotan todos los intentos.
  let lastError: unknown;
  for (let attempt = 0; attempt < PROFILE_READ_MAX_ATTEMPTS; attempt++) {
    try {
      const snapshot = await getDoc(doc(db, "users", uid));
      if (snapshot.exists()) {
        const parsed = userDocSchema.parse(snapshot.data({ serverTimestamps: "estimate" }));
        return { uid, ...parsed };
      }
      lastError = undefined; // el documento no existe todavía: no es un error, solo hay que reintentar
    } catch (error) {
      lastError = error;
    }
    if (attempt < PROFILE_READ_MAX_ATTEMPTS - 1) {
      await delay(PROFILE_READ_BASE_DELAY_MS * 2 ** attempt);
    }
  }
  // Se agotaron los intentos: si el último problema fue un error real (no
  // "documento inexistente"), se relanza; si nunca hubo error y el documento
  // simplemente nunca apareció, se devuelve null como antes.
  if (lastError) {
    throw lastError instanceof Error ? lastError : new Error("Error desconocido al leer el perfil de usuario");
  }
  return null;
}

export interface CreateUserProfileInput {
  email: string;
  displayName: string | null;
}

// Crea el documento de perfil en "users/{uid}" durante el signup. El rol
// siempre se fija acá mismo como "customer": la función no lo recibe como
// parámetro, para que no exista ningún camino (ni por error de programación)
// donde el rol de un usuario nuevo dependa de un valor que venga del formulario.
export async function createUserProfile(uid: string, data: CreateUserProfileInput): Promise<void> {
  try {
    await setDoc(doc(db, "users", uid), {
      email: data.email,
      displayName: data.displayName,
      role: "customer",
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error("Error desconocido al crear el perfil de usuario");
  }
}

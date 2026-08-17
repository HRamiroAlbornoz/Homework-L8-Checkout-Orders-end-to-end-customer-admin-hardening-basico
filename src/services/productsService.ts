import {
  collection,
  query,
  where,
  orderBy,
  startAt,
  endAt,
  startAfter,
  limit,
  getDocs,
  addDoc,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type DocumentData,
  type FirestoreDataConverter,
} from "firebase/firestore";
import { FirebaseError } from "firebase/app";
import { db } from "../lib/firebase";
import { MIN_SEARCH_CHARS } from "../constants/search";
import { productDocSchema, type Product, type ProductDoc, type ProductQueryParams } from "../types/product";

// Traduce entre el documento crudo de Firestore (ProductDoc, sin id) y el
// modelo que usa la app (Product, con id). fromFirestore valida con Zod antes
// de confiar en la forma del documento: si Firestore devolviera un doc corrupto
// o incompleto, acá se corta con un error claro en vez de propagar datos inválidos.
const productConverter: FirestoreDataConverter<Product, ProductDoc> = {
  toFirestore: (): never => {
    // Este catálogo es de solo lectura: nunca se escriben productos desde el
    // frontend. FirestoreDataConverter exige implementar toFirestore igual,
    // así que si alguna vez se llamara por error, preferimos fallar fuerte
    // y explícito en vez de mapear campos que no vamos a usar.
    throw new Error("toFirestore no está implementado: este catálogo es de solo lectura.");
  },
  fromFirestore: (snapshot, options) => {
    const raw = snapshot.data(options);
    const parsed = productDocSchema.parse(raw);
    return { id: snapshot.id, ...parsed };
  },
};

export interface ListProductsResult {
  items: Product[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
}

export async function listProducts(params: ProductQueryParams): Promise<ListProductsResult> {
  try {
    const productsRef = collection(db, "products").withConverter(productConverter);
    const constraints: QueryConstraint[] = [];

    if (params.categoryId) {
      constraints.push(where("categoryId", "==", params.categoryId));
    }

    if (params.searchPrefix && params.searchPrefix.length >= MIN_SEARCH_CHARS) {
      const prefix = params.searchPrefix.toLowerCase();
      // Rango de prefijo: todo lo que empiece con "prefix" queda entre
      // startAt(prefix) y endAt(prefix + ''), el carácter Unicode más alto,
      // que actúa como "fin de rango" en el patrón oficial de Firestore.
      constraints.push(orderBy("nameLower"));
      constraints.push(startAt(prefix));
      constraints.push(endAt(prefix + ""));
    } else {
      // Sin búsqueda: igual ordenamos por nameLower para que la paginación
      // sea estable (el mismo orderBy en la primera página y en "cargar más").
      constraints.push(orderBy("nameLower"));
    }

    constraints.push(limit(params.pageSize));

    if (params.cursor) {
      // startAfter (no startAt) para "cargar más": evita repetir el último
      // producto de la página anterior.
      constraints.push(startAfter(params.cursor));
    }

    const q = query(productsRef, ...constraints);
    const snapshot = await getDocs(q);

    const items = snapshot.docs.map((doc) => doc.data());
    const lastDoc = snapshot.docs.at(-1) ?? null;

    return { items, lastDoc };
  } catch (error) {
    // Nunca un catch vacío: relanzamos un Error legible para que el
    // ProductsContext lo capture y muestre el ErrorState con retry.
    throw error instanceof Error ? error : new Error("Error desconocido al consultar productos");
  }
}

export interface CreateProductInput {
  name: string;
  categoryId: string;
  price: number;
  imageUrl: string;
}

/**
 * Crea un producto en el catálogo. Solo la usa el panel de administración.
 *
 * @returns el id del documento recién creado.
 * @throws  Error con mensaje legible; nunca el error crudo del SDK.
 *
 * No usa el productConverter a propósito: ese converter existe para LEER
 * (valida con Zod lo que viene de Firestore y le agrega el id del documento), y
 * su toFirestore lanza un error justamente para que nadie lo use al revés. Acá
 * el documento se arma explícitamente, que además deja a la vista qué campos se
 * escriben — algo que un converter escondería.
 */
export async function createProduct(input: CreateProductInput): Promise<string> {
  try {
    const productRef = await addDoc(collection(db, "products"), {
      name: input.name,
      // nameLower lo deriva el service, no lo recibe: es un campo técnico que
      // existe solo para que la búsqueda por prefijo funcione sin importar cómo
      // el admin haya escrito las mayúsculas. Si viniera del formulario, bastaría
      // un descuido para que un producto quedara invisible en las búsquedas.
      nameLower: input.name.toLowerCase(),
      categoryId: input.categoryId,
      price: input.price,
      imageUrl: input.imageUrl,
    });

    return productRef.id;
  } catch (error) {
    // El error del SDK NUNCA se relanza tal cual: sus mensajes están en inglés,
    // son técnicos, y llegan directo a la pantalla del admin. Un
    // "FirebaseError: Missing or insufficient permissions." no le dice a nadie
    // qué hacer.
    //
    // El error original queda en "cause" y en el registro, que es donde sirve.
    console.error("[createProduct] Error al crear el producto", error);

    if (error instanceof FirebaseError && error.code === "permission-denied") {
      throw new Error(
        "No tenés permisos para crear productos. Verificá que tu cuenta sea de administrador.",
        { cause: error },
      );
    }

    throw new Error("No pudimos crear el producto. Intentá de nuevo en unos minutos.", {
      cause: error,
    });
  }
}

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import { CATEGORIES, type CategoryId } from "../src/constants/categories.js";
import type { ProductDoc } from "../src/types/product.js";
import { loadServiceAccount } from "./serviceAccount.js";

// Este script usa el SDK de ADMIN de Firebase, no el SDK cliente.
//
// Por qué: el SDK cliente se autentica como un usuario y por lo tanto queda
// sujeto a las reglas de seguridad (firestore.rules), que solo permiten crear
// productos a un administrador logueado. Un script de Node no tiene sesión de
// usuario, así que con el SDK cliente la escritura se rechaza siempre.
//
// El SDK de Admin se autentica con una credencial de servicio y NO pasa por las
// reglas: es la herramienta correcta para tareas administrativas fuera de la
// aplicación. Esa potencia es también su riesgo — de ahí que la credencial viva
// solo en .env (ignorado por git) y nunca en el código.
//
// Efecto secundario deseado: correr este script es la forma más rápida de
// comprobar que FIREBASE_SERVICE_ACCOUNT_JSON está bien armado, ANTES de
// cargarlo en Vercel, donde diagnosticar el mismo problema cuesta mucho más.

// process.loadEnvFile es la API nativa de Node para leer un .env: no hace falta
// dotenv. Este script corre con tsx, fuera de Vite, así que import.meta.env no
// existe acá.
process.loadEnvFile(".env");

const seedEnvSchema = z.object({
  FIREBASE_SERVICE_ACCOUNT_JSON: z
    .string()
    .min(1, "Falta FIREBASE_SERVICE_ACCOUNT_JSON en .env (Firebase Console → Configuración → Cuentas de servicio)"),
});

const env = seedEnvSchema.parse(process.env);

// El parseo y la validación de la credencial viven en scripts/serviceAccount.ts,
// porque los comparte con el script de verificación de reglas.
const app = initializeApp({
  credential: cert(loadServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON)),
});

const db = getFirestore(app);

// Nombres de producto por categoría. Se repiten a propósito varias marcas
// ("Nike", "Adidas", "Nintendo", "Nivea") en distintas categorías, para poder
// demostrar la búsqueda por prefijo (ej: "ni" o "a") combinada con el filtro
// de categoría durante la verificación manual.
const CATALOG_SEED: Record<CategoryId, string[]> = {
  calzado: [
    "Nike Air Max 90",
    "Nike Air Force 1",
    "Nike Zoom Pegasus 40",
    "Nike Revolution 6",
    "Nike Court Vision",
    "Adidas Ultraboost 22",
    "Adidas Superstar",
    "Adidas Stan Smith",
    "Adidas Gazelle",
    "Puma Suede Classic",
    "Puma RS-X",
    "Reebok Classic Leather",
    "Reebok Club C 85",
    "Vans Old Skool",
    "Vans Sk8-Hi",
    "New Balance 574",
  ],
  ropa: [
    "Nike Dri-FIT Remera",
    "Nike Windrunner Campera",
    "Nike Sportswear Short",
    "Nike Tech Fleece Buzo",
    "Adidas Track Jacket",
    "Adidas Firebird Pantalón",
    "Adidas 3-Stripes Short",
    "Puma Essentials Hoodie",
    "Puma Classics Pantalón",
    "Levi's 501 Jean",
    "Levi's Trucker Campera",
    "Champion Reverse Weave Buzo",
    "Under Armour Tech Remera",
    "The North Face Campera",
    "Wrangler Jean Slim",
  ],
  accesorios: [
    "Nike Heritage Mochila",
    "Nike Dri-FIT Gorra",
    "Nike Elite Medias",
    "Adidas Linear Mochila",
    "Adidas Baseball Gorra",
    "Adidas Running Cinturón",
    "Puma Phase Mochila",
    "Ray-Ban Aviator Anteojos",
    "Casio G-Shock Reloj",
    "Fossil Cuero Reloj",
    "Nixon Time Teller Reloj",
    "Herschel Little America Mochila",
    "New Era 9FIFTY Gorra",
    "Vans Old Skool Riñonera",
    "Nivea Kit Viaje Neceser",
  ],
  electronica: [
    "Nintendo Switch OLED",
    "Nintendo Switch Lite",
    "Nintendo 3DS XL",
    "Apple AirPods Pro",
    "Apple Watch SE",
    "Apple iPad 10",
    "Asus ROG Mouse",
    "Asus VivoBook Notebook",
    "Asus Zenfone Celular",
    "Samsung Galaxy A54",
    "Samsung Smart TV 50",
    "Sony WH-1000XM5 Auriculares",
    "LG Monitor 27",
    "Xiaomi Redmi Note",
    "Logitech MX Master Mouse",
  ],
  hogar: [
    "Nivea Set Aromatizador",
    "Nivea Difusor Ambiente",
    "Ariston Cafetera",
    "Ariston Pava Eléctrica",
    "Oster Licuadora",
    "Philips Aspiradora",
    "Philips Plancha Vapor",
    "Tefal Sartén Antiadherente",
    "Umco Juego de Sábanas",
    "Cannon Toallas Set",
    "Essen Olla a Presión",
    "Adidas Toalla Deportiva",
    "Nike Vaso Térmico",
    "Home Elegance Cortinas",
  ],
};

// Rango de precio (ARS) por categoría, solo para que la UI se vea realista.
const PRICE_RANGES: Record<CategoryId, [number, number]> = {
  calzado: [15000, 80000],
  ropa: [8000, 45000],
  accesorios: [3000, 60000],
  electronica: [20000, 900000],
  hogar: [5000, 150000],
};

interface SeedProduct {
  name: string;
  categoryId: CategoryId;
  price: number;
}

function randomPrice(min: number, max: number): number {
  // Redondeado a la decena más cercana para que no se vea un número "de más".
  return Math.round((Math.random() * (max - min) + min) / 10) * 10;
}

// Con noUncheckedIndexedAccess, indexar un Record siempre da "V | undefined"
// (por si la clave no existiera). Acá SÍ debería existir siempre una entrada
// por cada categoría de CATEGORIES; si no la hay, es un error de configuración
// real (alguien agregó una categoría y se olvidó de sumarla acá) y preferimos
// fallar fuerte y claro en vez de generar productos con datos incompletos.
function getRequired<K extends string, V>(record: Record<K, V>, key: K): V {
  const value = record[key];
  if (value === undefined) {
    throw new Error(`Falta configuración de seed para la categoría "${key}"`);
  }
  return value;
}

function buildSeedProducts(): SeedProduct[] {
  const products: SeedProduct[] = [];

  for (const category of CATEGORIES) {
    const names = getRequired(CATALOG_SEED, category.id);
    const [min, max] = getRequired(PRICE_RANGES, category.id);

    for (const name of names) {
      products.push({ name, categoryId: category.id, price: randomPrice(min, max) });
    }
  }

  return products;
}

async function seed(): Promise<void> {
  const productsRef = db.collection("products");

  // Guarda contra el error más fácil de cometer con un script así: correrlo dos
  // veces y terminar con el catálogo duplicado. Este script solo AGREGA
  // documentos (cada uno con un id nuevo), nunca actualiza los existentes, así
  // que una segunda corrida no "vuelve a dejar todo como estaba": deja el doble.
  //
  // limit(1) alcanza para saber si hay algo: traer la colección entera solo para
  // preguntar "¿está vacía?" costaría una lectura por documento.
  const existing = await productsRef.limit(1).get();
  const forceRequested = process.argv.includes("--force");

  if (!existing.empty && !forceRequested) {
    console.log(
      "La colección 'products' ya tiene documentos. No se insertó nada.\n" +
        "Si querés agregar el seed igual (se sumará a lo existente), corré: npm run seed -- --force",
    );
    return;
  }

  const products = buildSeedProducts();

  // Un batch de Firestore admite hasta 500 operaciones. Este seed genera ~80, así
  // que entra holgado en uno solo; si el catálogo creciera, habría que partirlo.
  const batch = db.batch();

  for (const product of products) {
    // doc() sin argumento genera un id automático, igual que addDoc en el SDK
    // cliente.
    const data: ProductDoc = {
      name: product.name,
      nameLower: product.name.toLowerCase(),
      categoryId: product.categoryId,
      price: product.price,
    };
    batch.set(productsRef.doc(), data);
  }

  try {
    await batch.commit();
    console.log(`Seed completado: ${products.length} productos insertados en 'products'.`);
  } catch (error) {
    console.error("Error al insertar el seed:", error);
    process.exitCode = 1;
  }
}

seed();

import { z } from "zod";
import { Timestamp } from "firebase/firestore";

// Roles posibles de un usuario. Unión cerrada a propósito: agregar un rol nuevo
// (ej. "manager") implica extender esta lista y revisar cada lugar que la consume
// (AdminRoute, Header, reglas de Firestore), no solo agregar un string suelto.
export const userRoleSchema = z.enum(["customer", "admin"]);

export type UserRole = z.infer<typeof userRoleSchema>;

// Forma del documento tal como vive DENTRO de Firestore, en "users/{uid}".
// Sin "uid": no es un campo del documento, es el identificador del documento
// (llega aparte, vía snapshot.id), igual que "id" en product.ts.
export const userDocSchema = z.object({
  email: z.string().email(),
  // Firebase Auth expone displayName como "string | null" (nunca "undefined"):
  // se respeta el mismo tipo acá para no chocar con exactOptionalPropertyTypes,
  // que distingue "campo ausente" de "campo con valor null".
  displayName: z.string().min(1).nullable(),
  role: userRoleSchema,
  createdAt: z.custom<Timestamp>((value) => value instanceof Timestamp, {
    message: "createdAt debe ser un Timestamp de Firestore",
  }),
});

export type UserDoc = z.infer<typeof userDocSchema>;

// Forma completa que usa la app (con "uid" ya incorporado), la que consume AuthContext.
export const userSchema = userDocSchema.extend({ uid: z.string() });

export type UserProfile = z.infer<typeof userSchema>;

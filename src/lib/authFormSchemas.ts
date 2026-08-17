import { z } from "zod";

// Límites máximos defensivos (no solo mínimos): sin esto, cualquier campo
// aceptaría un string arbitrariamente largo (ej. varios MB pegados en el
// input) y ese payload viajaría tal cual a Firebase Auth/Firestore, sin
// ningún tope — un vector de DoS y de documentos anormalmente grandes.
const EMAIL_MAX_LENGTH = 254; // límite práctico de un email según RFC 5321
const DISPLAY_NAME_MAX_LENGTH = 100;
const PASSWORD_MAX_LENGTH = 128;

// Reutilizado entre LoginForm y SignupForm: mismo formato de email en ambos
// formularios, así el criterio de validación no queda duplicado en dos lugares.
// .pipe() encadena dos schemas en orden: primero valida como string (vacío/
// longitud), y SOLO si eso pasa, el resultado pasa al validador de formato
// (z.email()). Así, un campo vacío muestra "es obligatorio" en vez de "no es
// válido" — son mensajes distintos para errores distintos, y el orden importa
// para la experiencia de usuario (decirle "hace falta completar esto" es más
// claro que "el formato está mal" cuando ni siquiera escribió nada).
const emailSchema = z
  .string()
  .min(1, "El email es obligatorio.")
  .max(EMAIL_MAX_LENGTH, "El email es demasiado largo.")
  .pipe(z.email("El email no es válido."));

// Contraseña para SIGNUP (no para login, que no valida formato — ver más
// abajo). Firebase Auth exige un mínimo técnico de 6 caracteres, pero acá se
// exige el estándar de fortaleza real: 8+ caracteres con letras Y números.
const newPasswordSchema = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres.")
  .max(PASSWORD_MAX_LENGTH, "La contraseña es demasiado larga.")
  .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "La contraseña debe combinar letras y números.");

export const loginFormSchema = z.object({
  email: emailSchema,
  // En login no se valida el formato de la contraseña (podría haber sido
  // creada con reglas distintas en el pasado): solo que no venga vacía y que
  // no exceda el máximo (defensa contra pegar un payload gigante).
  password: z.string().min(1, "La contraseña es obligatoria.").max(PASSWORD_MAX_LENGTH, "La contraseña es demasiado larga."),
});

export type LoginFormValues = z.infer<typeof loginFormSchema>;

export const signupFormSchema = z
  .object({
    displayName: z
      .string()
      .min(1, "Ingresá un nombre para mostrar.")
      .max(DISPLAY_NAME_MAX_LENGTH, "El nombre es demasiado largo."),
    email: emailSchema,
    password: newPasswordSchema,
    confirmPassword: z.string().min(1, "Confirmá tu contraseña.").max(PASSWORD_MAX_LENGTH, "La contraseña es demasiado larga."),
  })
  // Las contraseñas se comparan ANTES de llamar a Firebase: "path" hace que
  // el mensaje de error se asocie al campo "confirmPassword", no a todo el form.
  .refine((data) => data.password === data.confirmPassword, {
    message: "Las contraseñas no coinciden.",
    path: ["confirmPassword"],
  });

export type SignupFormValues = z.infer<typeof signupFormSchema>;

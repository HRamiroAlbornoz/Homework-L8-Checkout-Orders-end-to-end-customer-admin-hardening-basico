import { describe, it, expect } from "vitest";
import { treeifyError } from "zod";
import { loginFormSchema, signupFormSchema } from "./authFormSchemas";

describe("loginFormSchema", () => {
  it("acepta un email y contraseña válidos", () => {
    const result = loginFormSchema.safeParse({ email: "hernan@example.com", password: "clave123" });

    expect(result.success).toBe(true);
  });

  it("rechaza un email vacío", () => {
    const result = loginFormSchema.safeParse({ email: "", password: "clave123" });

    expect(result.success).toBe(false);
  });

  it("rechaza un email con formato inválido", () => {
    const result = loginFormSchema.safeParse({ email: "no-es-un-email", password: "clave123" });

    expect(result.success).toBe(false);
  });

  it("rechaza una contraseña vacía", () => {
    const result = loginFormSchema.safeParse({ email: "hernan@example.com", password: "" });

    expect(result.success).toBe(false);
  });

  it("acepta una contraseña de un solo caracter (login no valida longitud mínima, solo que no esté vacía)", () => {
    const result = loginFormSchema.safeParse({ email: "hernan@example.com", password: "a" });

    expect(result.success).toBe(true);
  });

  it("rechaza si falta el campo email por completo", () => {
    const result = loginFormSchema.safeParse({ password: "clave123" });

    expect(result.success).toBe(false);
  });

  it("rechaza si falta el campo password por completo", () => {
    const result = loginFormSchema.safeParse({ email: "hernan@example.com" });

    expect(result.success).toBe(false);
  });

  it("rechaza un email con espacios (no es un formato de email válido)", () => {
    const result = loginFormSchema.safeParse({ email: "  hernan@example.com  ", password: "clave123" });

    expect(result.success).toBe(false);
  });

  it("acepta una contraseña compuesta solo por espacios (login no valida formato, solo longitud > 0)", () => {
    const result = loginFormSchema.safeParse({ email: "hernan@example.com", password: "   " });

    expect(result.success).toBe(true);
  });

  it("rechaza una contraseña más larga que el máximo permitido, aunque login no valide formato", () => {
    const result = loginFormSchema.safeParse({ email: "hernan@example.com", password: "a".repeat(129) });

    expect(result.success).toBe(false);
  });

  it("rechaza un email más largo que el máximo permitido", () => {
    const largoEmail = `${"a".repeat(250)}@x.co`;
    const result = loginFormSchema.safeParse({ email: largoEmail, password: "clave123" });

    expect(result.success).toBe(false);
  });
});

describe("signupFormSchema", () => {
  const validData = {
    displayName: "Hernán",
    email: "hernan@example.com",
    password: "clave123",
    confirmPassword: "clave123",
  };

  it("acepta datos completos y válidos", () => {
    const result = signupFormSchema.safeParse(validData);

    expect(result.success).toBe(true);
  });

  it("rechaza si las contraseñas no coinciden", () => {
    const result = signupFormSchema.safeParse({ ...validData, confirmPassword: "otraClave123" });

    expect(result.success).toBe(false);
  });

  it("asocia el error de contraseñas distintas al campo confirmPassword", () => {
    const result = signupFormSchema.safeParse({ ...validData, confirmPassword: "otraClave123" });

    expect(result.success).toBe(false);
    if (!result.success) {
      const tree = treeifyError(result.error);
      expect(tree.properties?.confirmPassword?.errors[0]).toBe("Las contraseñas no coinciden.");
    }
  });

  it("rechaza una contraseña de menos de 8 caracteres", () => {
    const result = signupFormSchema.safeParse({ ...validData, password: "abc1", confirmPassword: "abc1" });

    expect(result.success).toBe(false);
  });

  it("rechaza una contraseña de exactamente 7 caracteres (justo debajo del mínimo)", () => {
    const result = signupFormSchema.safeParse({ ...validData, password: "abcd123", confirmPassword: "abcd123" });

    expect(result.success).toBe(false);
  });

  it("acepta una contraseña de exactamente 8 caracteres con letras y números (límite inferior)", () => {
    const result = signupFormSchema.safeParse({ ...validData, password: "abcd1234", confirmPassword: "abcd1234" });

    expect(result.success).toBe(true);
  });

  it("rechaza una contraseña de solo letras (sin ningún número)", () => {
    const result = signupFormSchema.safeParse({
      ...validData,
      password: "soloLetras",
      confirmPassword: "soloLetras",
    });

    expect(result.success).toBe(false);
  });

  it("rechaza una contraseña de solo números (sin ninguna letra)", () => {
    const result = signupFormSchema.safeParse({ ...validData, password: "12345678", confirmPassword: "12345678" });

    expect(result.success).toBe(false);
  });

  it("rechaza una contraseña más larga que el máximo permitido (128 caracteres)", () => {
    const password = "a1".repeat(65); // 130 caracteres, letras y números mezclados
    const result = signupFormSchema.safeParse({ ...validData, password, confirmPassword: password });

    expect(result.success).toBe(false);
  });

  it("rechaza un email más largo que el máximo permitido (254 caracteres)", () => {
    const largoEmail = `${"a".repeat(250)}@x.co`;
    const result = signupFormSchema.safeParse({ ...validData, email: largoEmail });

    expect(result.success).toBe(false);
  });

  it("rechaza un displayName más largo que el máximo permitido (100 caracteres)", () => {
    const result = signupFormSchema.safeParse({ ...validData, displayName: "a".repeat(101) });

    expect(result.success).toBe(false);
  });

  it("rechaza un displayName vacío", () => {
    const result = signupFormSchema.safeParse({ ...validData, displayName: "" });

    expect(result.success).toBe(false);
  });

  it("rechaza un email con formato inválido", () => {
    const result = signupFormSchema.safeParse({ ...validData, email: "no-es-un-email" });

    expect(result.success).toBe(false);
  });

  it("rechaza si falta el campo confirmPassword por completo", () => {
    const { confirmPassword: _confirmPassword, ...dataSinConfirmar } = validData;
    void _confirmPassword;
    const result = signupFormSchema.safeParse(dataSinConfirmar);

    expect(result.success).toBe(false);
  });

  it("acepta un displayName con tildes y caracteres propios del español", () => {
    const result = signupFormSchema.safeParse({ ...validData, displayName: "José María Ñáñez" });

    expect(result.success).toBe(true);
  });

  it("acepta (sin filtrar) un displayName compuesto solo por espacios, porque min(1) cuenta caracteres, no contenido significativo", () => {
    const result = signupFormSchema.safeParse({ ...validData, displayName: "   " });

    expect(result.success).toBe(true);
  });
});

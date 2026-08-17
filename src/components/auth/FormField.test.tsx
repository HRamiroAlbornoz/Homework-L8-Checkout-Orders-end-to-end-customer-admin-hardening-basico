import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormField } from "./FormField";

// FormField es 100% controlado (no guarda su propio estado): para probar
// que escribir "actualiza" lo que se ve en pantalla, hace falta un wrapper
// que sí tenga estado real y se lo pase de vuelta como "value".
function ControlledFormField(props: { error?: string; disabled?: boolean }) {
  const [value, setValue] = useState("");
  return <FormField id="email" label="Email" type="email" value={value} onChange={setValue} {...props} />;
}

describe("FormField", () => {
  it("asocia el label al input mediante htmlFor/id", () => {
    render(<FormField id="email" label="Email" type="email" value="" onChange={vi.fn()} />);

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("llama a onChange con el nuevo valor al escribir", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<FormField id="email" label="Email" type="email" value="" onChange={handleChange} />);

    await user.type(screen.getByLabelText("Email"), "a");

    expect(handleChange).toHaveBeenCalledWith("a");
  });

  it("sin error, no muestra ningún mensaje ni marca aria-invalid", () => {
    render(<FormField id="email" label="Email" type="email" value="" onChange={vi.fn()} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "false");
  });

  it("con error, lo muestra y marca aria-invalid en el input", () => {
    render(
      <FormField id="email" label="Email" type="email" value="" onChange={vi.fn()} error="El email no es válido." />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("El email no es válido.");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it("el input queda vinculado al mensaje de error vía aria-describedby", () => {
    render(
      <FormField id="email" label="Email" type="email" value="" onChange={vi.fn()} error="El email no es válido." />
    );

    const input = screen.getByLabelText("Email");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBe("email-error");
    expect(document.getElementById(describedBy!)).toHaveTextContent("El email no es válido.");
  });

  it("se deshabilita cuando disabled es true", () => {
    render(<FormField id="email" label="Email" type="email" value="" onChange={vi.fn()} disabled />);

    expect(screen.getByLabelText("Email")).toBeDisabled();
  });

  it("aplica el autoComplete recibido", () => {
    render(
      <FormField
        id="password"
        label="Contraseña"
        type="password"
        value=""
        onChange={vi.fn()}
        autoComplete="current-password"
      />
    );

    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("autocomplete", "current-password");
  });

  it("marca el input como requerido (required + aria-required)", () => {
    render(<FormField id="email" label="Email" type="email" value="" onChange={vi.fn()} />);

    const input = screen.getByLabelText("Email");
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("aria-required", "true");
  });

  it("muestra el value controlado que recibe por props", () => {
    render(<FormField id="email" label="Email" type="email" value="hernan@example.com" onChange={vi.fn()} />);

    expect(screen.getByLabelText("Email")).toHaveValue("hernan@example.com");
  });

  it("type='password' arma un input de tipo password (no expone el texto)", () => {
    render(<FormField id="password" label="Contraseña" type="password" value="" onChange={vi.fn()} />);

    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "password");
  });

  it("type='text' arma un input de tipo text", () => {
    render(<FormField id="displayName" label="Nombre" type="text" value="" onChange={vi.fn()} />);

    expect(screen.getByLabelText("Nombre")).toHaveAttribute("type", "text");
  });

  it("sin autoComplete, no fija el atributo autocomplete", () => {
    render(<FormField id="email" label="Email" type="email" value="" onChange={vi.fn()} />);

    expect(screen.getByLabelText("Email")).not.toHaveAttribute("autocomplete");
  });

  it("sin la prop disabled, el input queda habilitado por defecto", () => {
    render(<FormField id="email" label="Email" type="email" value="" onChange={vi.fn()} />);

    expect(screen.getByLabelText("Email")).not.toBeDisabled();
  });

  it("escribir una palabra completa actualiza el valor mostrado letra por letra (componente controlado real)", async () => {
    const user = userEvent.setup();
    render(<ControlledFormField />);

    await user.type(screen.getByLabelText("Email"), "hola");

    expect(screen.getByLabelText("Email")).toHaveValue("hola");
  });

  it("el id del mensaje de error se arma como '{id}-error' para cualquier id, no solo 'email'", () => {
    render(
      <FormField
        id="password"
        label="Contraseña"
        type="password"
        value=""
        onChange={vi.fn()}
        error="La contraseña debe tener al menos 6 caracteres."
      />
    );

    expect(screen.getByLabelText("Contraseña").getAttribute("aria-describedby")).toBe("password-error");
  });

  it("al pasar de con-error a sin-error (rerender), aria-invalid vuelve a 'false' y el alert desaparece", () => {
    const { rerender } = render(
      <FormField id="email" label="Email" type="email" value="" onChange={vi.fn()} error="El email no es válido." />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(<FormField id="email" label="Email" type="email" value="hernan@example.com" onChange={vi.fn()} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "false");
  });

  it("el label muestra exactamente el texto recibido, distinto de 'Email'", () => {
    render(
      <FormField id="signup-display-name" label="Nombre para mostrar" type="text" value="" onChange={vi.fn()} />
    );

    expect(screen.getByLabelText("Nombre para mostrar")).toBeInTheDocument();
  });

  it("el input es interactuable (se puede escribir) cuando disabled no está presente", async () => {
    const user = userEvent.setup();
    render(<ControlledFormField />);

    await user.click(screen.getByLabelText("Email"));
    await user.keyboard("x");

    expect(screen.getByLabelText("Email")).toHaveValue("x");
  });

  it("dos FormField con ids distintos no colisionan: cada uno muestra su propio mensaje de error", () => {
    render(
      <>
        <FormField id="email" label="Email" type="email" value="" onChange={vi.fn()} error="Error de email." />
        <FormField
          id="password"
          label="Contraseña"
          type="password"
          value=""
          onChange={vi.fn()}
          error="Error de contraseña."
        />
      </>
    );

    expect(document.getElementById("email-error")).toHaveTextContent("Error de email.");
    expect(document.getElementById("password-error")).toHaveTextContent("Error de contraseña.");
  });

  it("onChange recibe un string vacío al borrar todo el contenido del input", async () => {
    const user = userEvent.setup();
    render(<ControlledFormField />);

    await user.type(screen.getByLabelText("Email"), "ab");
    await user.clear(screen.getByLabelText("Email"));

    expect(screen.getByLabelText("Email")).toHaveValue("");
  });
});

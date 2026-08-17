import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { renderWithProviders } from "@/test/renderWithProviders";
import { server } from "@/test/msw/server";
import { FAKE_PUBLIC_URL, FAKE_UPLOAD_URL } from "@/test/msw/handlers";
import { PRESIGN_ENDPOINT } from "@/constants/uploads";

// Flow test del alta de productos con imagen (Opción B del enunciado).
//
// Acá conviven dos técnicas distintas, y la elección de cada una tiene motivo:
//
// - Las llamadas HTTP (presign + PUT a S3) las intercepta MSW, a nivel de red.
//   El código bajo test llama a fetch de verdad, con su URL, su método, sus
//   headers y su cuerpo reales. Si el service cambiara el endpoint o el método,
//   el test fallaría — algo que un vi.fn() que devuelve un objeto no detecta.
//
// - createProduct se mockea con vi.mock, porque no habla HTTP: usa el SDK de
//   Firestore, que abre su propio canal. MSW no lo vería.
//
// El resultado es que este test no toca la red ni necesita variables de entorno,
// y sigue pasando con el Wi-Fi apagado.

vi.mock("@/services/productsService", () => ({
  createProduct: vi.fn(),
}));

// Se mockea el módulo de Firebase para dar un usuario con token, y de paso para
// que importarlo no dispare la validación de variables de entorno que hace
// lib/env.ts al cargarse.
vi.mock("@/lib/firebase", () => ({
  auth: {
    currentUser: { getIdToken: vi.fn().mockResolvedValue("fake-id-token") },
  },
}));

import { createProduct } from "@/services/productsService";
import { CreateProductForm } from "./CreateProductForm";

// Registro de las requests que salieron, en orden. Sirve para verificar el
// criterio del enunciado: que el flujo haga las llamadas en la secuencia
// correcta (primero pedir la firma, después subir).
let requestLog: string[] = [];

function logRequest({ request }: { request: Request }): void {
  requestLog.push(`${request.method} ${new URL(request.url).pathname}`);
}

function makeImageFile(): File {
  // jsdom no lee archivos del disco: un File se construye en memoria. El
  // contenido no importa, sí el type y el tamaño, que son lo que se valida.
  return new File(["contenido-binario-falso"], "zapatilla.png", { type: "image/png" });
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText("Nombre"), "Nike Air Max 90");
  await user.selectOptions(screen.getByLabelText("Categoría"), "calzado");
  await user.type(screen.getByLabelText("Precio"), "75410");
  await user.upload(screen.getByLabelText("Imagen"), makeImageFile());
}

function getSubmitButton(): HTMLElement {
  return screen.getByRole("button", { name: /crear producto/i });
}

beforeEach(() => {
  requestLog = [];
  server.events.on("request:start", logRequest);
});

afterEach(() => {
  server.events.removeListener("request:start", logRequest);
  vi.restoreAllMocks();
});

describe("CreateProductForm — camino feliz", () => {
  it("pide la firma y recién después sube la imagen, en ese orden", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateProductForm />);

    await fillValidForm(user);
    await user.click(getSubmitButton());

    await waitFor(() => {
      expect(requestLog).toEqual([
        "POST /api/uploads/presign",
        "PUT /products/fake-uuid.png",
      ]);
    });
  });

  it("manda el token del usuario y los datos del archivo al pedir la firma", async () => {
    const user = userEvent.setup();
    let receivedAuthorization: string | null = null;
    let receivedBody: unknown = null;

    server.use(
      http.post(PRESIGN_ENDPOINT, async ({ request }) => {
        receivedAuthorization = request.headers.get("authorization");
        receivedBody = await request.json();
        return HttpResponse.json({
          uploadUrl: FAKE_UPLOAD_URL,
          publicUrl: FAKE_PUBLIC_URL,
          key: "products/fake-uuid.png",
        });
      }),
    );

    renderWithProviders(<CreateProductForm />);
    await fillValidForm(user);
    await user.click(getSubmitButton());

    await waitFor(() => expect(receivedAuthorization).toBe("Bearer fake-id-token"));
    // El nombre del archivo NO viaja: el servidor genera el suyo con un UUID.
    expect(receivedBody).toEqual({ contentType: "image/png", size: expect.any(Number) });
  });

  it("crea el producto con la URL pública devuelta por el servidor", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateProductForm />);

    await fillValidForm(user);
    await user.click(getSubmitButton());

    await waitFor(() =>
      expect(createProduct).toHaveBeenCalledWith({
        name: "Nike Air Max 90",
        categoryId: "calzado",
        price: 75410,
        imageUrl: FAKE_PUBLIC_URL,
      }),
    );
  });

  it("muestra la confirmación con el producto y su imagen", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateProductForm />);

    await fillValidForm(user);
    await user.click(getSubmitButton());

    expect(await screen.findByText(/«Nike Air Max 90» se creó correctamente/i)).toBeInTheDocument();
    // La imagen se busca por su texto alternativo, que es como la encuentra
    // alguien que usa un lector de pantalla.
    expect(screen.getByAltText("Nike Air Max 90")).toHaveAttribute("src", FAKE_PUBLIC_URL);
  });

  it("limpia el formulario después de crear el producto", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateProductForm />);

    await fillValidForm(user);
    await user.click(getSubmitButton());
    await screen.findByText(/se creó correctamente/i);

    expect(screen.getByLabelText("Nombre")).toHaveValue("");
    expect(screen.getByLabelText("Precio")).toHaveValue(null);
  });
});

describe("CreateProductForm — el servidor rechaza la firma", () => {
  it("muestra el mensaje del servidor y NO crea el producto", async () => {
    const user = userEvent.setup();
    // 403: el usuario está autenticado pero no es admin. Es el escenario real
    // que protege la Vercel Function.
    server.use(
      http.post(PRESIGN_ENDPOINT, () =>
        HttpResponse.json(
          { code: "FORBIDDEN", message: "No tenés permisos para subir imágenes." },
          { status: 403 },
        ),
      ),
    );

    renderWithProviders(<CreateProductForm />);
    await fillValidForm(user);
    await user.click(getSubmitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no tenés permisos para subir imágenes/i,
    );
    // Lo importante: no quedó un producto creado apuntando a una imagen que
    // nunca se subió.
    expect(createProduct).not.toHaveBeenCalled();
  });
});

describe("CreateProductForm — la subida a S3 falla", () => {
  it("avisa del error y NO crea el producto sin imagen", async () => {
    const user = userEvent.setup();
    server.use(http.put(FAKE_UPLOAD_URL, () => new HttpResponse(null, { status: 500 })));

    renderWithProviders(<CreateProductForm />);
    await fillValidForm(user);
    await user.click(getSubmitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/no pudimos subir la imagen/i);
    // Este es el motivo por el que la imagen se sube ANTES de crear el producto:
    // si el orden fuera al revés, acá habría quedado un producto en el catálogo
    // apuntando a una imagen inexistente, visible para todos los clientes.
    expect(createProduct).not.toHaveBeenCalled();
  });
});

describe("CreateProductForm — validaciones antes de salir a la red", () => {
  it("sin imagen no hace ninguna request", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateProductForm />);

    await user.type(screen.getByLabelText("Nombre"), "Nike Air Max 90");
    await user.type(screen.getByLabelText("Precio"), "75410");
    await user.click(getSubmitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/elegí una imagen/i);
    expect(requestLog).toEqual([]);
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("con el nombre vacío avisa y no sube nada", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateProductForm />);

    await user.type(screen.getByLabelText("Precio"), "75410");
    await user.upload(screen.getByLabelText("Imagen"), makeImageFile());
    await user.click(getSubmitButton());

    expect(await screen.findByText(/el nombre es obligatorio/i)).toBeInTheDocument();
    expect(requestLog).toEqual([]);
  });

  it("con precio 0 avisa que debe ser mayor a 0", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateProductForm />);

    await user.type(screen.getByLabelText("Nombre"), "Nike Air Max 90");
    await user.type(screen.getByLabelText("Precio"), "0");
    await user.upload(screen.getByLabelText("Imagen"), makeImageFile());
    await user.click(getSubmitButton());

    expect(await screen.findByText(/el precio debe ser mayor a 0/i)).toBeInTheDocument();
    expect(requestLog).toEqual([]);
  });

  it("rechaza un archivo que no es una imagen permitida", async () => {
    // applyAccept: false desactiva el filtro que userEvent aplica según el
    // atributo "accept" del input. Sin esto, el archivo .sh ni siquiera llegaría
    // al componente y el test verificaría el filtro del navegador en vez de
    // nuestra validación.
    //
    // Y ese escenario es real, no artificial: en el diálogo del sistema
    // operativo, el usuario puede cambiar a "Todos los archivos" y elegir lo que
    // quiera. El atributo "accept" es comodidad, nunca una barrera.
    const user = userEvent.setup({ applyAccept: false });
    renderWithProviders(<CreateProductForm />);

    await user.type(screen.getByLabelText("Nombre"), "Nike Air Max 90");
    await user.type(screen.getByLabelText("Precio"), "75410");
    await user.upload(
      screen.getByLabelText("Imagen"),
      new File(["#!/bin/sh"], "script.sh", { type: "application/x-sh" }),
    );
    await user.click(getSubmitButton());

    expect(await screen.findByText(/la imagen debe ser jpg, png o webp/i)).toBeInTheDocument();
    expect(requestLog).toEqual([]);
  });
});

describe("CreateProductForm — el usuario nunca ve un error técnico", () => {
  it("si el servidor devuelve una respuesta con forma inesperada, muestra un mensaje entendible", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    // Un 200 con un cuerpo que no cumple el schema. Antes, el ZodError llegaba
    // a la pantalla con su mensaje: un volcado en JSON de la lista de problemas.
    server.use(
      http.post(PRESIGN_ENDPOINT, () => HttpResponse.json({ algo: "inesperado" })),
    );

    renderWithProviders(<CreateProductForm />);
    await fillValidForm(user);
    await user.click(getSubmitButton());

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(/no pudimos preparar la subida de la imagen/i);
    // Ni rastro del volcado técnico de Zod.
    expect(alerta).not.toHaveTextContent(/invalid_type|expected|received/i);
    // El detalle sí queda registrado, que es donde sirve.
    expect(consoleError).toHaveBeenCalled();
    expect(createProduct).not.toHaveBeenCalled();
  });
});

describe("CreateProductForm — la confirmación no sobrevive a un intento fallido", () => {
  it("al reenviar, borra el mensaje de éxito anterior antes de mostrar el error nuevo", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => {});

    renderWithProviders(<CreateProductForm />);

    // Primer alta: exitosa.
    await fillValidForm(user);
    await user.click(getSubmitButton());
    await screen.findByText(/se creó correctamente/i);

    // Segundo intento: el servidor lo rechaza.
    server.use(
      http.post(PRESIGN_ENDPOINT, () =>
        HttpResponse.json(
          { code: "FORBIDDEN", message: "No tenés permisos para subir imágenes." },
          { status: 403 },
        ),
      ),
    );

    await fillValidForm(user);
    await user.click(getSubmitButton());
    await screen.findByRole("alert");

    // Sin la corrección, acá convivían en pantalla el "se creó correctamente"
    // del producto anterior y el cartel de error del nuevo: dos mensajes que se
    // contradicen y dejan al usuario sin saber qué pasó.
    expect(screen.queryByText(/se creó correctamente/i)).not.toBeInTheDocument();
  });
});

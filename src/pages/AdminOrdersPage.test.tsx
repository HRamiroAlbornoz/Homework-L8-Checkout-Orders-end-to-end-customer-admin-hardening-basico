import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeOrder } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import { ORDER_ERROR_CODES } from "../lib/orderErrorCodes";
import { OrderError } from "../lib/orderErrors";

// Igual que en OrdersPage.test.tsx: se mockea el service, no el hook, para que
// la carga real (useAdminOrders → useAsyncData) corra de verdad.
vi.mock("../services/ordersService", () => ({
  listOrders: vi.fn(),
  updateOrderStatus: vi.fn(),
}));

import { listOrders, updateOrderStatus } from "../services/ordersService";
import { AdminOrdersPage } from "./AdminOrdersPage";

/** El <select> de acción de una fila, buscado por su label accesible. */
function selectorDeEstado(orderId: string): HTMLElement {
  return screen.getByLabelText(new RegExp(`cambiar el estado de la orden ${orderId}`, "i"));
}

beforeEach(() => {
  vi.mocked(updateOrderStatus).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AdminOrdersPage — los tres estados", () => {
  it("muestra el indicador de carga mientras espera", () => {
    vi.mocked(listOrders).mockReturnValue(new Promise(() => {}));

    renderWithProviders(<AdminOrdersPage />);

    expect(screen.getByText(/cargando las órdenes/i)).toBeInTheDocument();
  });

  it("avisa cuando todavía no hay ninguna orden", async () => {
    vi.mocked(listOrders).mockResolvedValue([]);

    renderWithProviders(<AdminOrdersPage />);

    expect(await screen.findByText(/todavía no hay ninguna orden/i)).toBeInTheDocument();
  });

  it("muestra un mensaje entendible si la consulta falla", async () => {
    vi.mocked(listOrders).mockRejectedValue(
      new OrderError(ORDER_ERROR_CODES.MISSING_INDEX, "Falta un índice."),
    );

    renderWithProviders(<AdminOrdersPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/falta un índice/i);
  });
});

describe("AdminOrdersPage — filtro por estado", () => {
  it("consulta sin filtro al entrar", async () => {
    vi.mocked(listOrders).mockResolvedValue([]);

    renderWithProviders(<AdminOrdersPage />);

    await waitFor(() => {
      expect(listOrders).toHaveBeenCalledWith({});
    });
  });

  it("vuelve a consultar filtrando cuando se elige un estado", async () => {
    const user = userEvent.setup();
    vi.mocked(listOrders).mockResolvedValue([]);

    renderWithProviders(<AdminOrdersPage />);
    await screen.findByText(/todavía no hay ninguna orden/i);

    await user.selectOptions(screen.getByLabelText(/filtrar por estado/i), "processing");

    // El filtrado ocurre en FIRESTORE, no en memoria: filtrar en el cliente
    // obligaría a leer todas las órdenes siempre, y cada lectura se cobra.
    await waitFor(() => {
      expect(listOrders).toHaveBeenCalledWith({ status: "processing" });
    });
  });

  it("el mensaje de vacío dice por qué estado se filtró", async () => {
    const user = userEvent.setup();
    vi.mocked(listOrders).mockResolvedValue([]);

    renderWithProviders(<AdminOrdersPage />);
    await screen.findByText(/todavía no hay ninguna orden/i);

    await user.selectOptions(screen.getByLabelText(/filtrar por estado/i), "completed");

    // "No hay resultados" a secas dejaría al admin sin saber si el filtro está
    // aplicado o si de verdad no existe ninguna orden.
    expect(await screen.findByText(/no hay órdenes en estado "Completada"/i)).toBeInTheDocument();
  });
});

describe("AdminOrdersPage — transiciones ofrecidas", () => {
  it("desde 'pending' ofrece solo preparación y cancelación", async () => {
    vi.mocked(listOrders).mockResolvedValue([makeOrder({ id: "o-1", status: "pending" })]);

    renderWithProviders(<AdminOrdersPage />);

    const selector = await screen.findByLabelText(/cambiar el estado de la orden o-1/i);
    const opciones = within(selector).getAllByRole("option").map((o) => o.textContent);

    // "Completada" NO aparece: no se puede dar por entregada una orden que
    // todavía no se preparó.
    expect(opciones).toEqual(["Cambiar a…", "En preparación", "Cancelada"]);
  });

  it("desde 'processing' ofrece completar y cancelar", async () => {
    vi.mocked(listOrders).mockResolvedValue([makeOrder({ id: "o-1", status: "processing" })]);

    renderWithProviders(<AdminOrdersPage />);

    const selector = await screen.findByLabelText(/cambiar el estado de la orden o-1/i);
    const opciones = within(selector).getAllByRole("option").map((o) => o.textContent);

    expect(opciones).toEqual(["Cambiar a…", "Completada", "Cancelada"]);
  });

  it("no ofrece ninguna acción sobre una orden en estado final", async () => {
    vi.mocked(listOrders).mockResolvedValue([makeOrder({ id: "o-1", status: "completed" })]);

    renderWithProviders(<AdminOrdersPage />);

    expect(await screen.findByText(/estado final/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/cambiar el estado/i)).not.toBeInTheDocument();
  });
});

describe("AdminOrdersPage — cambio de estado", () => {
  it("pide confirmación nombrando la orden y los dos estados", async () => {
    const user = userEvent.setup();
    vi.mocked(listOrders).mockResolvedValue([makeOrder({ id: "o-1", status: "pending" })]);

    renderWithProviders(<AdminOrdersPage />);
    await screen.findByLabelText(/cambiar el estado de la orden o-1/i);

    await user.selectOptions(selectorDeEstado("o-1"), "processing");

    // Un "¿estás seguro?" a secas obligaría al admin a recordar de memoria
    // sobre cuál de las filas hizo clic.
    const confirmacion = await screen.findByRole("alertdialog");
    expect(confirmacion).toHaveTextContent(/o-1/);
    expect(confirmacion).toHaveTextContent(/Pendiente/);
    expect(confirmacion).toHaveTextContent(/En preparación/);
    expect(confirmacion).toHaveTextContent(/no se puede deshacer/i);
  });

  it("NO escribe nada hasta que se confirma", async () => {
    const user = userEvent.setup();
    vi.mocked(listOrders).mockResolvedValue([makeOrder({ id: "o-1", status: "pending" })]);

    renderWithProviders(<AdminOrdersPage />);
    await screen.findByLabelText(/cambiar el estado de la orden o-1/i);

    await user.selectOptions(selectorDeEstado("o-1"), "processing");
    await screen.findByRole("alertdialog");

    expect(updateOrderStatus).not.toHaveBeenCalled();
  });

  it("aplica el cambio al confirmar", async () => {
    const user = userEvent.setup();
    vi.mocked(listOrders).mockResolvedValue([makeOrder({ id: "o-1", status: "pending" })]);

    renderWithProviders(<AdminOrdersPage />);
    await screen.findByLabelText(/cambiar el estado de la orden o-1/i);

    await user.selectOptions(selectorDeEstado("o-1"), "cancelled");
    await user.click(await screen.findByRole("button", { name: /sí, cambiar el estado/i }));

    await waitFor(() => {
      expect(updateOrderStatus).toHaveBeenCalledWith("o-1", "cancelled");
    });
  });

  it("vuelve a consultar la lista después de un cambio exitoso", async () => {
    const user = userEvent.setup();
    vi.mocked(listOrders).mockResolvedValue([makeOrder({ id: "o-1", status: "pending" })]);

    renderWithProviders(<AdminOrdersPage />);
    await screen.findByLabelText(/cambiar el estado de la orden o-1/i);

    const consultasIniciales = vi.mocked(listOrders).mock.calls.length;

    await user.selectOptions(selectorDeEstado("o-1"), "processing");
    await user.click(await screen.findByRole("button", { name: /sí, cambiar el estado/i }));

    // Se relee desde Firestore en vez de actualizar la fila en memoria: es lo
    // que garantiza que se vea lo que quedó guardado, incluido el updatedAt que
    // puso el servidor y que el cliente no conoce.
    await waitFor(() => {
      expect(vi.mocked(listOrders).mock.calls.length).toBeGreaterThan(consultasIniciales);
    });
  });

  it("cancelar cierra la confirmación sin escribir nada", async () => {
    const user = userEvent.setup();
    vi.mocked(listOrders).mockResolvedValue([makeOrder({ id: "o-1", status: "pending" })]);

    renderWithProviders(<AdminOrdersPage />);
    await screen.findByLabelText(/cambiar el estado de la orden o-1/i);

    await user.selectOptions(selectorDeEstado("o-1"), "processing");
    await user.click(await screen.findByRole("button", { name: /^cancelar$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(updateOrderStatus).not.toHaveBeenCalled();
  });

  it("muestra el error si la escritura falla, y deja la confirmación abierta", async () => {
    const user = userEvent.setup();
    vi.mocked(listOrders).mockResolvedValue([makeOrder({ id: "o-1", status: "pending" })]);
    vi.mocked(updateOrderStatus).mockRejectedValue(
      new OrderError(ORDER_ERROR_CODES.PERMISSION_DENIED, "No tenés permiso."),
    );

    renderWithProviders(<AdminOrdersPage />);
    await screen.findByLabelText(/cambiar el estado de la orden o-1/i);

    await user.selectOptions(selectorDeEstado("o-1"), "processing");
    await user.click(await screen.findByRole("button", { name: /sí, cambiar el estado/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no tenés permiso/i);

    // La confirmación sigue en pantalla: el cambio no se aplicó, así que
    // cerrarla daría a entender que sí.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});

describe("AdminOrdersPage — accesibilidad de la confirmación", () => {
  it("mueve el foco al botón de confirmar al abrirse", async () => {
    const user = userEvent.setup();
    vi.mocked(listOrders).mockResolvedValue([makeOrder({ id: "o-1", status: "pending" })]);

    renderWithProviders(<AdminOrdersPage />);
    await screen.findByLabelText(/cambiar el estado de la orden o-1/i);

    await user.selectOptions(selectorDeEstado("o-1"), "processing");

    // El panel se renderiza ARRIBA de la tabla pero se dispara desde un <select>
    // que está DENTRO de ella. Sin mover el foco, quien navega con teclado sigue
    // tabulando hacia adelante y nunca llega a los botones: quedaron detrás en
    // el orden del documento. La acción sería inalcanzable sin mouse.
    expect(await screen.findByRole("button", { name: /sí, cambiar el estado/i })).toHaveFocus();
  });

  it("el diálogo se anuncia con el texto del cambio, no como 'diálogo' a secas", async () => {
    const user = userEvent.setup();
    vi.mocked(listOrders).mockResolvedValue([makeOrder({ id: "o-1", status: "pending" })]);

    renderWithProviders(<AdminOrdersPage />);
    await screen.findByLabelText(/cambiar el estado de la orden o-1/i);

    await user.selectOptions(selectorDeEstado("o-1"), "processing");

    const dialogo = await screen.findByRole("alertdialog");
    expect(dialogo).toHaveAccessibleName(/vas a cambiar la orden o-1/i);
  });

  it("Escape cancela sin escribir nada", async () => {
    const user = userEvent.setup();
    vi.mocked(listOrders).mockResolvedValue([makeOrder({ id: "o-1", status: "pending" })]);

    renderWithProviders(<AdminOrdersPage />);
    await screen.findByLabelText(/cambiar el estado de la orden o-1/i);

    await user.selectOptions(selectorDeEstado("o-1"), "processing");
    await screen.findByRole("alertdialog");

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(updateOrderStatus).not.toHaveBeenCalled();
  });

  it("al confirmar con éxito, el foco no se pierde en el body", async () => {
    const user = userEvent.setup();
    vi.mocked(listOrders).mockResolvedValue([makeOrder({ id: "o-1", status: "pending" })]);

    renderWithProviders(<AdminOrdersPage />);
    await screen.findByLabelText(/cambiar el estado de la orden o-1/i);

    await user.selectOptions(selectorDeEstado("o-1"), "processing");
    await user.click(await screen.findByRole("button", { name: /sí, cambiar el estado/i }));

    // No se puede devolver el foco al <select> que abrió la confirmación: la
    // lista se recarga y ese nodo deja de existir, así que el foco terminaría en
    // el <body> y quien navega con teclado tendría que empezar de nuevo desde
    // arriba de la página. Va al encabezado de la sección, que sobrevive.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Órdenes" })).toHaveFocus();
    });
  });

  it("anuncia el cambio aplicado en una región live", async () => {
    const user = userEvent.setup();
    vi.mocked(listOrders).mockResolvedValue([makeOrder({ id: "o-1", status: "pending" })]);

    renderWithProviders(<AdminOrdersPage />);
    await screen.findByLabelText(/cambiar el estado de la orden o-1/i);

    await user.selectOptions(selectorDeEstado("o-1"), "processing");
    await user.click(await screen.findByRole("button", { name: /sí, cambiar el estado/i }));

    // Sin este mensaje, quien usa un lector de pantalla solo percibe que la
    // confirmación desapareció, sin saber si el cambio se guardó o se canceló.
    expect(await screen.findByRole("status")).toHaveTextContent(
      /la orden o-1 pasó a En preparación/i,
    );
  });

  it("al cancelar devuelve el foco al selector que lo abrió", async () => {
    const user = userEvent.setup();
    vi.mocked(listOrders).mockResolvedValue([makeOrder({ id: "o-1", status: "pending" })]);

    renderWithProviders(<AdminOrdersPage />);
    await screen.findByLabelText(/cambiar el estado de la orden o-1/i);

    await user.selectOptions(selectorDeEstado("o-1"), "processing");
    await user.click(await screen.findByRole("button", { name: /^cancelar$/i }));

    // Sin esto, cancelar deja el foco en la nada y hay que recorrer la página
    // entera de nuevo para retomar donde se estaba.
    await waitFor(() => {
      expect(selectorDeEstado("o-1")).toHaveFocus();
    });
  });
});

describe("AdminOrdersPage — el listado", () => {
  it("muestra el cliente, las unidades y el total de cada orden", async () => {
    vi.mocked(listOrders).mockResolvedValue([
      makeOrder({
        id: "o-1",
        userId: "uid-del-comprador",
        total: 200110,
        items: [
          { productId: "p-1", name: "Adidas Gazelle", priceAtPurchase: 26000, quantity: 2 },
          { productId: "p-2", name: "Apple Watch SE", priceAtPurchase: 148110, quantity: 1 },
        ],
      }),
    ]);

    renderWithProviders(<AdminOrdersPage />);

    expect(await screen.findByText("uid-del-comprador")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/200\.110/)).toBeInTheDocument();
  });

  it("cada select tiene su propio label accesible", async () => {
    // Sin label, un lector de pantalla que salta de control en control anuncia
    // solo "lista desplegable": no pasa por el encabezado de la columna, así que
    // no hay forma de saber a qué orden corresponde.
    vi.mocked(listOrders).mockResolvedValue([
      makeOrder({ id: "o-1", status: "pending" }),
      makeOrder({ id: "o-2", status: "pending" }),
    ]);

    renderWithProviders(<AdminOrdersPage />);

    expect(await screen.findByLabelText(/cambiar el estado de la orden o-1/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cambiar el estado de la orden o-2/i)).toBeInTheDocument();
  });
});

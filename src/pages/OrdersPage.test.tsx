import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeOrder } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import { ORDER_ERROR_CODES } from "../lib/orderErrorCodes";
import { OrderError } from "../lib/orderErrors";

// Se mockea la CAPA DE SERVICIOS, no el SDK de Firebase ni el hook.
//
// Mockear el hook probaría que la página sabe leer un objeto que le pasamos
// nosotros, y no probaría nada de la carga real. Mockeando el service, corren de
// verdad useCustomerOrders y useAsyncData, así que el test cubre también la
// transición entre los tres estados — que es justamente lo que puede romperse.
vi.mock("../services/ordersService", () => ({
  getOrdersByUser: vi.fn(),
}));

vi.mock("../contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../contexts/AuthContext";
import { getOrdersByUser } from "../services/ordersService";
import { OrdersPage } from "./OrdersPage";

const CUSTOMER_UID = "uid-customer";

function mockLoggedInUser(): void {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      uid: CUSTOMER_UID,
      email: "hernan@example.com",
      displayName: "Hernán",
      role: "customer",
      createdAt: {} as never,
    },
    loading: false,
    error: null,
    signup: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

beforeEach(() => {
  mockLoggedInUser();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OrdersPage — los tres estados", () => {
  it("muestra el indicador de carga mientras espera la respuesta", () => {
    // La promesa queda pendiente a propósito: así se congela el estado de carga
    // y se puede afirmar sobre él.
    vi.mocked(getOrdersByUser).mockReturnValue(new Promise(() => {}));

    renderWithProviders(<OrdersPage />);

    expect(screen.getByText(/cargando tus órdenes/i)).toBeInTheDocument();
  });

  it("muestra el mensaje de vacío cuando no hay ninguna orden", async () => {
    vi.mocked(getOrdersByUser).mockResolvedValue([]);

    renderWithProviders(<OrdersPage />);

    // El mensaje explica además qué hacer para que aparezca algo: un "no hay
    // nada" a secas deja al usuario sin saber si es un error o si nunca compró.
    expect(await screen.findByText(/aún no tienes órdenes/i)).toBeInTheDocument();
  });

  it("muestra un mensaje entendible cuando la consulta falla", async () => {
    vi.mocked(getOrdersByUser).mockRejectedValue(
      new OrderError(
        ORDER_ERROR_CODES.MISSING_INDEX,
        "No pudimos ordenar los resultados en este momento.",
      ),
    );

    renderWithProviders(<OrdersPage />);

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(/no pudimos ordenar los resultados/i);
  });

  it("nunca deja pasar el mensaje técnico del SDK", async () => {
    vi.mocked(getOrdersByUser).mockRejectedValue(
      new OrderError(ORDER_ERROR_CODES.UNKNOWN_ERROR, "No pudimos completar la operación."),
    );

    renderWithProviders(<OrdersPage />);
    await screen.findByRole("alert");

    expect(screen.queryByText(/FirebaseError|permission-denied/i)).not.toBeInTheDocument();
  });

  it("permite reintentar después de un error", async () => {
    const user = userEvent.setup();
    vi.mocked(getOrdersByUser)
      .mockRejectedValueOnce(new OrderError(ORDER_ERROR_CODES.NETWORK_ERROR, "Sin conexión."))
      .mockResolvedValueOnce([makeOrder({ id: "orden-recuperada" })]);

    renderWithProviders(<OrdersPage />);
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: /reintentar/i }));

    expect(await screen.findByText(/orden-recuperada/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("OrdersPage — el listado", () => {
  it("consulta las órdenes del usuario en sesión", async () => {
    vi.mocked(getOrdersByUser).mockResolvedValue([]);

    renderWithProviders(<OrdersPage />);

    await waitFor(() => {
      expect(getOrdersByUser).toHaveBeenCalledWith(CUSTOMER_UID);
    });
  });

  it("muestra el estado, la fecha, las unidades y el total de cada orden", async () => {
    vi.mocked(getOrdersByUser).mockResolvedValue([
      makeOrder({
        id: "orden-visible",
        status: "processing",
        total: 200110,
        items: [
          { productId: "p-1", name: "Adidas Gazelle", priceAtPurchase: 26000, quantity: 2 },
          { productId: "p-2", name: "Apple Watch SE", priceAtPurchase: 148110, quantity: 1 },
        ],
      }),
    ]);

    renderWithProviders(<OrdersPage />);

    expect(await screen.findByText("En preparación")).toBeInTheDocument();
    expect(screen.getByText(/orden-visible/)).toBeInTheDocument();
    // 2 + 1 unidades, no 2 líneas: lo que se compara es la cantidad total.
    expect(screen.getByText(/3 unidades/)).toBeInTheDocument();
    expect(screen.getByText(/200\.110/)).toBeInTheDocument();
  });

  it("dice 'unidad' en singular cuando hay una sola", async () => {
    vi.mocked(getOrdersByUser).mockResolvedValue([
      makeOrder({
        items: [{ productId: "p-1", name: "Nike", priceAtPurchase: 100, quantity: 1 }],
      }),
    ]);

    renderWithProviders(<OrdersPage />);

    expect(await screen.findByText(/1 unidad$/)).toBeInTheDocument();
  });

  it("enlaza cada orden con su detalle", async () => {
    vi.mocked(getOrdersByUser).mockResolvedValue([makeOrder({ id: "abc123" })]);

    renderWithProviders(<OrdersPage />);

    const enlace = await screen.findByRole("link", { name: /abc123/ });
    expect(enlace).toHaveAttribute("href", "/orders/abc123");
  });

  it("respeta el orden en que vienen las órdenes del service", async () => {
    // El orden lo decide la consulta a Firestore (createdAt desc), no la
    // pantalla. Si la página reordenara por su cuenta, el criterio quedaría
    // duplicado en dos lugares que pueden discrepar.
    vi.mocked(getOrdersByUser).mockResolvedValue([
      makeOrder({ id: "la-mas-nueva" }),
      makeOrder({ id: "la-mas-vieja" }),
    ]);

    renderWithProviders(<OrdersPage />);
    await screen.findByText(/la-mas-nueva/);

    const enlaces = screen.getAllByRole("link");
    expect(enlaces[0]).toHaveAttribute("href", "/orders/la-mas-nueva");
    expect(enlaces[1]).toHaveAttribute("href", "/orders/la-mas-vieja");
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeCartItem } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { CartState } from "@/features/cart/types";
import { CART_STORAGE_KEY } from "@/features/cart/cartConstants";
import { ORDER_ERROR_CODES } from "../lib/orderErrorCodes";
import { OrderError } from "../lib/orderErrors";

// Flow test del checkout (Opción A del enunciado).
//
// Se mockea la CAPA DE SERVICIOS, no el SDK de Firebase. La diferencia importa:
// mockear el SDK obligaría a imitar addDoc, collection y serverTimestamp, y el
// test terminaría probando que sabemos usar Firebase. Mockeando el service, el
// test prueba lo que de verdad interesa: que la PÁGINA reaccione bien según la
// operación salga bien o mal.
//
// Como consecuencia, este test no toca la red ni necesita variables de entorno:
// createOrderFromCart es la única puerta hacia Firestore, y está tapada.
vi.mock("../services/ordersService", () => ({
  createOrderFromCart: vi.fn(),
}));

vi.mock("../contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../contexts/AuthContext";
import { createOrderFromCart } from "../services/ordersService";
import { CheckoutPage } from "./CheckoutPage";

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

const cartWithTwoProducts: CartState = {
  items: [
    makeCartItem({ productId: "p-1", name: "Nike Air Max 90", unitPrice: 100, quantity: 2 }),
    makeCartItem({ productId: "p-2", name: "Adidas Gazelle", unitPrice: 50, quantity: 1 }),
  ],
  totalItems: 3,
  totalPrice: 250,
};

function renderCheckout(preloadedCartState: CartState = cartWithTwoProducts) {
  return renderWithProviders(<CheckoutPage />, { preloadedCartState });
}

function getConfirmButton(): HTMLElement {
  return screen.getByRole("button", { name: /confirmar compra/i });
}

beforeEach(() => {
  window.localStorage.clear();
  mockLoggedInUser();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CheckoutPage — compra exitosa", () => {
  it("crea la orden con el usuario y el carrito actuales", async () => {
    const user = userEvent.setup();
    vi.mocked(createOrderFromCart).mockResolvedValue("orden-123");
    renderCheckout();

    await user.click(getConfirmButton());

    expect(createOrderFromCart).toHaveBeenCalledWith(CUSTOMER_UID, {
      items: cartWithTwoProducts.items,
      totalItems: 3,
      totalPrice: 250,
    });
  });

  it("muestra la confirmación con el número de orden", async () => {
    const user = userEvent.setup();
    vi.mocked(createOrderFromCart).mockResolvedValue("orden-123");
    renderCheckout();

    await user.click(getConfirmButton());

    expect(await screen.findByText(/gracias por tu compra/i)).toBeInTheDocument();
    expect(screen.getByText("orden-123")).toBeInTheDocument();
  });

  it("vacía el carrito después de registrar la orden", async () => {
    const user = userEvent.setup();
    vi.mocked(createOrderFromCart).mockResolvedValue("orden-123");
    renderCheckout();

    await user.click(getConfirmButton());
    await screen.findByText(/gracias por tu compra/i);

    // Se comprueba en localStorage y no solo en pantalla: el carrito tiene que
    // quedar vacío DE VERDAD, no simplemente dejar de mostrarse. Si solo se
    // ocultara, el usuario volvería a la home y encontraría los productos ahí,
    // como si no hubiera comprado nada.
    const storedCart = JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) ?? "{}");
    expect(storedCart).toMatchObject({ items: [], totalItems: 0, totalPrice: 0 });
  });
});

describe("CheckoutPage — la compra falla", () => {
  it("muestra un mensaje de error entendible, no el error técnico", async () => {
    const user = userEvent.setup();
    vi.mocked(createOrderFromCart).mockRejectedValue(
      new OrderError(
        ORDER_ERROR_CODES.NETWORK_ERROR,
        "No pudimos conectarnos con el servidor. Revisá tu conexión e intentá de nuevo.",
        { retryable: true },
      ),
    );
    renderCheckout();

    await user.click(getConfirmButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no pudimos conectarnos con el servidor/i);
  });

  it("NO vacía el carrito si la orden no se pudo crear", async () => {
    const user = userEvent.setup();
    vi.mocked(createOrderFromCart).mockRejectedValue(
      new OrderError(ORDER_ERROR_CODES.UNKNOWN_ERROR, "Algo salió mal."),
    );
    renderCheckout();

    await user.click(getConfirmButton());
    await screen.findByRole("alert");

    // El caso que este test previene: vaciar el carrito en el "finally" en vez
    // de dentro del "try". Con esa versión, el usuario perdería su carrito por
    // una compra que nunca se registró.
    expect(screen.getByText(/nike air max 90/i)).toBeInTheDocument();
    expect(screen.getByText(/adidas gazelle/i)).toBeInTheDocument();
    const storedCart = JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) ?? "{}");
    expect(storedCart).toMatchObject({ totalItems: 3, totalPrice: 250 });
  });

  it("el botón vuelve a habilitarse para poder reintentar", async () => {
    const user = userEvent.setup();
    vi.mocked(createOrderFromCart).mockRejectedValue(
      new OrderError(ORDER_ERROR_CODES.UNKNOWN_ERROR, "Algo salió mal."),
    );
    renderCheckout();

    await user.click(getConfirmButton());
    await screen.findByRole("alert");

    expect(getConfirmButton()).toBeEnabled();
  });

  it("limpia el error anterior al reintentar con éxito", async () => {
    const user = userEvent.setup();
    vi.mocked(createOrderFromCart)
      .mockRejectedValueOnce(new OrderError(ORDER_ERROR_CODES.UNKNOWN_ERROR, "Algo salió mal."))
      .mockResolvedValueOnce("orden-456");
    renderCheckout();

    await user.click(getConfirmButton());
    await screen.findByRole("alert");

    await user.click(getConfirmButton());

    expect(await screen.findByText(/gracias por tu compra/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("CheckoutPage — protección contra doble envío", () => {
  it("dos clicks disparados antes de que React re-renderice crean UNA sola orden", async () => {
    // La promesa queda pendiente a propósito: reproduce el momento real en el
    // que el usuario impaciente vuelve a hacer click porque "no pasó nada".
    let resolveOrder!: (orderId: string) => void;
    vi.mocked(createOrderFromCart).mockReturnValue(
      new Promise<string>((resolve) => {
        resolveOrder = resolve;
      }),
    );
    renderCheckout();
    const button = getConfirmButton();

    // Acá NO se usa userEvent, y es a propósito. userEvent espera a que React
    // termine de re-renderizar entre un click y el siguiente, así que el segundo
    // click ya encuentra el botón deshabilitado y nunca llega al manejador: el
    // test pasaría aunque el código no tuviera ninguna protección real.
    //
    // Los dos fireEvent dentro de un mismo act() se despachan sin re-render en
    // el medio, que es la carrera que de verdad ocurre en un navegador cuando
    // alguien hace dos clicks muy rápidos. Es el único escenario donde el
    // atributo "disabled" todavía no se aplicó y hace falta el cerrojo del ref.
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    // Sin el cerrojo del useRef, este número es 2: el usuario termina con dos
    // órdenes idénticas y el doble del cargo.
    expect(createOrderFromCart).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveOrder("orden-789");
    });
  });

  it("mientras se envía, el botón se deshabilita y avisa que está procesando", async () => {
    const user = userEvent.setup();
    let resolveOrder!: (orderId: string) => void;
    vi.mocked(createOrderFromCart).mockReturnValue(
      new Promise<string>((resolve) => {
        resolveOrder = resolve;
      }),
    );
    renderCheckout();

    await user.click(getConfirmButton());

    expect(screen.getByRole("button", { name: /confirmando compra/i })).toBeDisabled();

    await act(async () => {
      resolveOrder("orden-789");
    });
  });
});

describe("CheckoutPage — carrito vacío", () => {
  it("no ofrece confirmar una compra sin productos", () => {
    renderCheckout({ items: [], totalItems: 0, totalPrice: 0 });

    expect(screen.getByText(/tu carrito está vacío/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirmar compra/i })).not.toBeInTheDocument();
    expect(createOrderFromCart).not.toHaveBeenCalled();
  });
});

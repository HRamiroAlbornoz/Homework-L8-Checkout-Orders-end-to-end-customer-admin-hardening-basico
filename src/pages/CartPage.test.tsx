import { describe, it, expect, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeCartItem } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import { MAX_QUANTITY_PER_ITEM } from "@/features/cart/cartConstants";
import type { CartState } from "@/features/cart/types";
import { CartPage } from "./CartPage";

// Tests de la página del carrito. Al renderizarla se ejercitan también
// CartItemRow y QuantitySelector, que solo existen dentro de ella: testearlos
// por separado sería testear piezas que ningún usuario ve aisladas.
//
// El estado inicial se inyecta con preloadedCartState en vez de simular los
// clicks que llenarían el carrito. Eso mantiene cada test enfocado en lo que
// realmente prueba, y evita que un test de "eliminar" falle por un problema en
// el botón de "agregar".

const cartWithTwoProducts: CartState = {
  items: [
    makeCartItem({ productId: "p-1", name: "Nike Air Max 90", unitPrice: 100, quantity: 2 }),
    makeCartItem({ productId: "p-2", name: "Adidas Gazelle", unitPrice: 50, quantity: 1 }),
  ],
  totalItems: 3,
  totalPrice: 250,
};

function renderCartPage(preloadedCartState?: CartState) {
  return renderWithProviders(<CartPage />, { preloadedCartState });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("CartPage — estado vacío", () => {
  it("muestra un mensaje de carrito vacío y un camino de vuelta al catálogo", () => {
    renderCartPage();

    expect(screen.getByText(/tu carrito está vacío/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ver el catálogo/i })).toBeInTheDocument();
  });

  it("no muestra el total ni el botón de vaciar cuando no hay nada que vaciar", () => {
    renderCartPage();

    expect(screen.queryByRole("button", { name: /vaciar carrito/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /finalizar compra/i })).not.toBeInTheDocument();
  });
});

describe("CartPage — con productos", () => {
  it("lista un ítem por producto, como lista accesible", () => {
    renderCartPage(cartWithTwoProducts);

    // getAllByRole("listitem") verifica de paso que se usó <ul>/<li> real: si
    // fueran <div>, no existiría el rol y esta query devolvería una lista vacía.
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Nike Air Max 90" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Adidas Gazelle" })).toBeInTheDocument();
  });

  it("muestra el total de unidades y el monto total", () => {
    renderCartPage(cartWithTwoProducts);

    expect(screen.getByText(/total \(3 unidades\)/i)).toBeInTheDocument();
  });

  it("ofrece el camino al checkout", () => {
    renderCartPage(cartWithTwoProducts);

    expect(screen.getByRole("link", { name: /finalizar compra/i })).toHaveAttribute(
      "href",
      "/checkout",
    );
  });
});

describe("CartPage — cambiar cantidades", () => {
  it("el botón + suma una unidad al producto correcto", async () => {
    const user = userEvent.setup();
    renderCartPage(cartWithTwoProducts);

    await user.click(
      screen.getByRole("button", { name: /agregar una unidad de adidas gazelle/i }),
    );

    expect(screen.getByText(/total \(4 unidades\)/i)).toBeInTheDocument();
  });

  it("el botón − resta una unidad", async () => {
    const user = userEvent.setup();
    renderCartPage(cartWithTwoProducts);

    await user.click(
      screen.getByRole("button", { name: /quitar una unidad de nike air max 90/i }),
    );

    expect(screen.getByText(/total \(2 unidades\)/i)).toBeInTheDocument();
  });

  it("bajar de 1 a 0 elimina la fila del carrito", async () => {
    const user = userEvent.setup();
    renderCartPage(cartWithTwoProducts);

    // Adidas Gazelle está en cantidad 1: un click en "−" la lleva a 0.
    await user.click(
      screen.getByRole("button", { name: /quitar una unidad de adidas gazelle/i }),
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Adidas Gazelle" })).not.toBeInTheDocument();
  });

  it("deshabilita el botón + al llegar al máximo de unidades", () => {
    renderCartPage({
      items: [
        makeCartItem({
          productId: "p-1",
          name: "Nike Air Max 90",
          unitPrice: 100,
          quantity: MAX_QUANTITY_PER_ITEM,
        }),
      ],
      totalItems: MAX_QUANTITY_PER_ITEM,
      totalPrice: 100 * MAX_QUANTITY_PER_ITEM,
    });

    expect(
      screen.getByRole("button", { name: /agregar una unidad de nike air max 90/i }),
    ).toBeDisabled();
  });
});

describe("CartPage — eliminar y vaciar", () => {
  it("el botón Eliminar saca solo el producto de esa fila", async () => {
    const user = userEvent.setup();
    renderCartPage(cartWithTwoProducts);

    await user.click(
      screen.getByRole("button", { name: /eliminar nike air max 90 del carrito/i }),
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Adidas Gazelle" })).toBeInTheDocument();
  });

  it("vaciar el carrito pide confirmación antes de borrar nada", async () => {
    const user = userEvent.setup();
    renderCartPage(cartWithTwoProducts);

    await user.click(screen.getByRole("button", { name: /vaciar carrito/i }));

    // Lo importante: después de pedir vaciar, el carrito TODAVÍA está intacto.
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("la confirmación nombra los productos que se van a perder", async () => {
    const user = userEvent.setup();
    renderCartPage(cartWithTwoProducts);

    await user.click(screen.getByRole("button", { name: /vaciar carrito/i }));

    // Un "¿Estás seguro?" a secas obligaría al usuario a recordar de memoria
    // qué había en el carrito para poder decidir.
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/nike air max 90/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/adidas gazelle/i)).toBeInTheDocument();
  });

  it("cancelar la confirmación deja el carrito como estaba", async () => {
    const user = userEvent.setup();
    renderCartPage(cartWithTwoProducts);

    await user.click(screen.getByRole("button", { name: /vaciar carrito/i }));
    await user.click(screen.getByRole("button", { name: /cancelar/i }));

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("confirmar vacía el carrito y muestra el estado vacío", async () => {
    const user = userEvent.setup();
    renderCartPage(cartWithTwoProducts);

    await user.click(screen.getByRole("button", { name: /vaciar carrito/i }));
    await user.click(screen.getByRole("button", { name: /sí, vaciar el carrito/i }));

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText(/tu carrito está vacío/i)).toBeInTheDocument();
  });
});

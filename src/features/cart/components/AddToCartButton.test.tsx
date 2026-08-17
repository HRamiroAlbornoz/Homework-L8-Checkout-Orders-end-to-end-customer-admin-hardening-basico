import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeProduct } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { Product } from "@/types/product";
import { AddToCartButton } from "./AddToCartButton";
import { CartBadge } from "./CartBadge";

// Tests del botón "Agregar al carrito" con interacción real de usuario.
//
// Se renderiza junto al CartBadge a propósito. Un test que solo verificara que
// el botón existe y se puede clickear no probaría nada útil: lo que importa es
// que el click tenga un EFECTO OBSERVABLE. El badge es ese efecto — es lo mismo
// que ve el usuario para saber que su producto entró al carrito.
//
// Las queries son por rol accesible (getByRole) y no por clase CSS o test-id:
// así el test encuentra los elementos de la misma forma en que los encuentra un
// lector de pantalla. Si el test pasa, la interfaz es navegable.

function CartHarness({ products }: { products: Product[] }) {
  return (
    <>
      {products.map((product) => (
        <AddToCartButton key={product.id} product={product} />
      ))}
      <CartBadge />
    </>
  );
}

function getCartLink(): HTMLElement {
  return screen.getByRole("link", { name: /carrito/i });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AddToCartButton", () => {
  it("el nombre accesible del botón incluye el producto, para poder distinguirlo entre varios", () => {
    renderWithProviders(<CartHarness products={[makeProduct({ name: "Nike Air Max 90" })]} />);

    expect(
      screen.getByRole("button", { name: /agregar al carrito nike air max 90/i }),
    ).toBeInTheDocument();
  });

  it("al hacer click, el contador del carrito pasa de 0 a 1", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CartHarness products={[makeProduct()]} />);

    expect(getCartLink()).toHaveAccessibleName(/0 productos/i);

    await user.click(screen.getByRole("button", { name: /agregar al carrito/i }));

    expect(getCartLink()).toHaveAccessibleName(/1 producto\b/i);
  });

  it("hacer click dos veces sobre el mismo producto suma 2 unidades", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CartHarness products={[makeProduct()]} />);
    const button = screen.getByRole("button", { name: /agregar al carrito/i });

    await user.click(button);
    await user.click(button);

    expect(getCartLink()).toHaveAccessibleName(/2 productos/i);
  });

  it("agregar dos productos distintos suma ambos al contador", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CartHarness
        products={[
          makeProduct({ id: "p-1", name: "Nike Air Max 90" }),
          makeProduct({ id: "p-2", name: "Adidas Gazelle", price: 50 }),
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /nike air max 90/i }));
    await user.click(screen.getByRole("button", { name: /adidas gazelle/i }));

    expect(getCartLink()).toHaveAccessibleName(/2 productos/i);
  });

  it("muestra una confirmación en el botón después de agregar", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CartHarness products={[makeProduct()]} />);

    await user.click(screen.getByRole("button", { name: /agregar al carrito/i }));

    expect(screen.getByRole("button", { name: /¡agregado!/i })).toBeInTheDocument();
  });

  it("la confirmación desaparece sola y el botón vuelve a su texto normal", async () => {
    // Relojes falsos: el componente espera 2 segundos reales antes de volver al
    // texto original. Sin esto, el test tendría que esperar de verdad 2 segundos
    // (lento) o adivinar cuánto esperar (intermitente). Con relojes falsos, el
    // tiempo se adelanta a voluntad y el test es instantáneo y determinista.
    // "shouldAdvanceTime: true" es imprescindible acá, y cuesta de encontrar:
    // con relojes falsos a secas, el tiempo NO avanza solo, y userEvent usa
    // temporizadores internos para simular los tiempos reales de un click. Esos
    // temporizadores quedaban esperando para siempre a que alguien adelantara el
    // reloj, así que el "await user.click(...)" nunca se resolvía y el test
    // moría por timeout a los 5 segundos. Con esta opción, el reloj falso avanza
    // automáticamente al ritmo del real, lo que desbloquea a userEvent, y
    // advanceTimersByTime sigue disponible para saltar los 2 segundos de golpe.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // userEvent necesita saber cómo adelantar el reloj para coordinarse con él.
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWithProviders(<CartHarness products={[makeProduct()]} />);

    await user.click(screen.getByRole("button", { name: /agregar al carrito/i }));
    expect(screen.getByRole("button", { name: /¡agregado!/i })).toBeInTheDocument();

    // act() envuelve el avance del reloj porque disparar el temporizador provoca
    // un cambio de estado en React.
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByRole("button", { name: /agregar al carrito/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /¡agregado!/i })).not.toBeInTheDocument();
  });

  it("no ofrece agregar un producto sin precio: muestra el motivo en su lugar", () => {
    // makeProduct devuelve un precio por defecto; se lo saca explícitamente para
    // reproducir un documento de Firestore sin el campo "price", que el schema
    // de producto permite.
    const productWithoutPrice = makeProduct();
    delete productWithoutPrice.price;

    renderWithProviders(<CartHarness products={[productWithoutPrice]} />);

    expect(screen.queryByRole("button", { name: /agregar al carrito/i })).not.toBeInTheDocument();
    expect(screen.getByText(/precio no disponible/i)).toBeInTheDocument();
    expect(getCartLink()).toHaveAccessibleName(/0 productos/i);
  });
});

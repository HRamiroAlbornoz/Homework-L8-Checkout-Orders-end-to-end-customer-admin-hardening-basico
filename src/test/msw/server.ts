import { setupServer } from "msw/node";
import { handlers } from "./handlers";

// Servidor de MSW para el entorno de tests.
//
// MSW intercepta las requests a NIVEL DE RED, no reemplazando fetch con un mock.
// La diferencia práctica es grande: el código bajo test llama a fetch de verdad,
// con su URL, su método, sus headers y su cuerpo reales. Si mañana el service
// cambia el endpoint o el método, el test falla — cosa que un vi.fn() que
// devuelve un objeto no detectaría jamás.
//
// Su ciclo de vida (listen / resetHandlers / close) se configura en
// src/test/setup.ts, para que valga para toda la suite.
export const server = setupServer(...handlers);

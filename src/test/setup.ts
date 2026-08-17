import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { server } from "./msw/server";

// Este archivo corre UNA VEZ antes de cada archivo de test (lo declara
// "setupFiles" en vite.config.ts). Sirve para dejar preparado el entorno que
// todos los tests dan por sentado, sin repetirlo en cada archivo.
//
// 1) El import de "@testing-library/jest-dom/vitest" registra los matchers de
//    DOM en el "expect" de Vitest. Sin esto, escribir
//    expect(boton).toBeInTheDocument() falla con "toBeInTheDocument is not a
//    function": el matcher simplemente no existe.
//
// 2) cleanup() desmonta lo que se renderizó en el test anterior. Sin esto, los
//    componentes de un test quedan pegados en el DOM del siguiente, y una
//    query como getByRole("button") encuentra DOS botones y falla con un error
//    confuso ("found multiple elements") que no señala la causa real.
//
//    Testing Library ya hace esta limpieza sola cuando "globals: true" está
//    activo. Se mantiene explícita a propósito: el test no depende de un flag
//    de configuración que alguien podría cambiar más adelante sin darse cuenta
//    de que estaba sosteniendo la limpieza. Llamarla dos veces es inofensivo
//    (la segunda no encuentra nada que desmontar).
// 3) MSW intercepta las requests HTTP durante toda la suite.
//
//    onUnhandledRequest: "error" es la pieza que hace cumplir "los tests no usan
//    red real". Cualquier request que no tenga un handler declarado ROMPE el
//    test, nombrando el método y la URL. Sin esa opción, MSW la dejaría pasar a
//    la red de verdad: el test seguiría en verde en tu máquina, y fallaría en el
//    CI (sin internet) o gastaría cuota de una API real sin que nadie se entere.
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

// Descarta los handlers que un test haya agregado con server.use() para simular
// un fallo puntual. Sin esto, el handler que devuelve un 403 en un test seguiría
// activo en los siguientes, y el resultado dependería del orden de ejecución.
afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

afterEach(() => {
  cleanup();
});

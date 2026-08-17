import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { configDefaults } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Alias "@" apuntando a src/. Sin esto, un archivo profundo como
      // src/features/cart/components/AddToCartButton.tsx tendría que importar
      // los tipos con "../../../types/product": una ruta que hay que recalcular
      // a mano cada vez que el archivo se mueve de carpeta, y que no dice nada
      // sobre dónde vive realmente lo importado. Con el alias queda
      // "@/types/product", que es la misma ruta desde cualquier archivo.
      //
      // import.meta.url es la URL de ESTE archivo; fileURLToPath la convierte
      // en una ruta del sistema de archivos. Se hace así, y no con un string
      // fijo, para que funcione igual en Windows (con backslashes) y en Linux
      // (donde corre el CI).
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // El SDK de Firebase (Auth + Firestore) pesa ~567kB minificado (~167kB
    // gzipped) por sí solo. Separarlo del código propio de la app no baja el
    // peso total que descarga el navegador, pero sí trae dos beneficios
    // reales: el navegador puede cachear ese chunk de forma independiente
    // (cambia solo cuando se actualiza la versión de Firebase, no en cada
    // deploy de la app), y el chunk de código propio bajó de 883kB a 316kB,
    // quedando por debajo del umbral por primera vez. `manualChunks` está
    // deprecado en Vite 8 (Rolldown); la forma actual es `codeSplitting.groups`.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'firebase-vendor',
              test: /[\\/]node_modules[\\/](@firebase|firebase)[\\/]/,
            },
          ],
        },
      },
    },
    // El chunk de firebase-vendor (~567kB) sigue superando el umbral default
    // de 500kB, pero ya no es "código nuestro creciendo sin control": es el
    // peso real e irreducible del SDK completo de Auth + Firestore, ya
    // aislado en su propio chunk (ver arriba). Subir el límite acá evita que
    // Vite siga avisando sobre algo ya diagnosticado y sin margen de mejora
    // real dentro del alcance de este proyecto, sin ocultar una regresión
    // futura: si el chunk de la APP (no el de vendor) volviera a crecer más
    // allá de 600kB, el warning volvería a aparecer.
    chunkSizeWarningLimit: 600,
  },
  test: {
    // jsdom simula un DOM de navegador: lo necesitan los tests de hooks/componentes.
    environment: 'jsdom',
    // Matchers de jest-dom (toBeInTheDocument, etc.) + limpieza del DOM entre tests.
    setupFiles: ['./src/test/setup.ts'],
    // Expone describe/it/expect/vi como variables globales, sin importarlos en
    // cada archivo. Los tests que ya los importan explícitamente siguen
    // funcionando igual (el import gana sobre el global). El beneficio concreto
    // acá es que Testing Library detecta el "afterEach" global y limpia el DOM
    // sola, y que las librerías del ecosistema asumen este modo por defecto.
    globals: true,
    // Resetea el historial de llamadas de todos los mocks (vi.fn) antes de cada
    // test. Sin esto, un mock recuerda las llamadas del test anterior y una
    // aserción como expect(crearOrden).toHaveBeenCalledTimes(1) puede pasar o
    // fallar según el ORDEN en que corrieron los tests: el síntoma clásico del
    // test intermitente, que falla en CI y no se reproduce en tu máquina.
    clearMocks: true,
    // .worktrees/ contiene checkouts completos del proyecto (superpowers:using-git-worktrees):
    // sin esto, vitest corre también los tests de esas copias como si fueran del repo actual.
    exclude: [...configDefaults.exclude, '.worktrees/**'],
  },
})

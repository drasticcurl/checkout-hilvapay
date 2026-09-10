import type { Config } from 'tailwindcss';

/**
 * Paleta tomada del checkout que se está reemplazando, no inventada: el verde
 * del botón, el rojo de la barra del timer y el azul del precio son los que ya
 * vieron los compradores en KashPay. Cambiarlos ahora metería una variable de
 * conversión al mismo tiempo que el cambio de procesador, y no se podría saber
 * cuál de las dos movió el número.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Botón de compra. El degradado del funnel va de este verde al oscuro.
        comprar: { DEFAULT: '#16A34A', oscuro: '#15803D', claro: '#22C55E' },
        // Barra de "la oferta expira en".
        urgencia: '#DC2626',
        // Precio del producto en la card.
        precio: '#1D4ED8',
        borde: '#E5E7EB',
        texto: { DEFAULT: '#111827', suave: '#6B7280' },
      },
      maxWidth: {
        // Ancho de la columna del checkout. El de KashPay es ~560px.
        checkout: '35rem',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;

import type { Config } from 'tailwindcss';

/**
 * Dos paletas que nunca comparten pantalla, y por eso no se mezclan:
 *
 *  1. CHECKOUT (`comprar`, `urgencia`, `precio`, `borde`, `texto`) — los colores
 *     que ya vieron los compradores. Se conservan tal cual: cambiarlos metería
 *     una variable de conversión al mismo tiempo que el cambio de procesador y
 *     no se podría saber cuál de las dos movió el número.
 *
 *  2. PANEL (`panel`, `tinta`, `acento`, `vivo`, `peligro`, `alerta`) — sistema
 *     propio, neutros zinc con UN acento. Lo mira una sola persona, todos los
 *     días, para apretar interruptores que cobran plata de verdad.
 *
 * Cómo se reparte el color en el panel, y por qué:
 *   · acción primaria  → `tinta` (casi negro). Un neutro, no un acento: deja el
 *                        verde libre para significar UNA sola cosa.
 *   · `acento` cobalto → interactivo: nav activo, links, foco, seleccionado.
 *   · `vivo` verde     → estado "cobrando de verdad", y nada más.
 *   · `peligro` rojo   → destructivo y errores, y nada más.
 *   · `alerta` ámbar   → advertencias que no bloquean.
 *
 * `acento` (#2563EB) y `precio` (#1D4ED8) son los dos azules, pero uno vive solo
 * en el panel y el otro solo en el checkout. Nunca se ven juntos.
 *
 * Contraste verificado contra blanco: tinta 17.7:1 · tinta-2 7.7:1 ·
 * tinta-3 4.8:1 · acento 5.2:1 · precio 6.7:1. Todos pasan WCAG AA.
 *
 * Dos límites que hay que tener presentes al usar la paleta:
 *   · `tinta-3` sobre `panel-sup2` (el gris de las cabeceras y los campos
 *     deshabilitados) baja a 4.4:1 y NO pasa AA. Sobre ese fondo va `tinta-2`.
 *   · `tinta-4` da 2.6:1 contra blanco: es para bordes en hover y para el punto
 *     de "apagado". Nunca para texto.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Checkout ───────────────────────────────────────────────────────
        comprar: {
          DEFAULT: '#16A34A',
          oscuro: '#15803D',
          claro: '#22C55E',
          // El CTA usa el tono oscuro: con #16A34A el texto blanco de 16px
          // queda en 3.3:1 y no llega a AA. Con este, 5.0:1.
          boton: '#15803D',
          botonHover: '#166534',
        },
        urgencia: '#DC2626',
        precio: '#1D4ED8',
        borde: '#E5E7EB',
        texto: { DEFAULT: '#111827', suave: '#6B7280' },
        // El gris detrás de la card del checkout. Antes el body era blanco
        // liso y la card se fundía con el fondo — sin este color, nada
        // distingue dónde termina la página y empieza el formulario.
        fondoPagina: '#F3F4F6',

        // ── Panel ──────────────────────────────────────────────────────────
        panel: {
          fondo: '#FAFAFA',
          sup: '#FFFFFF',
          sup2: '#F4F4F5',
          sup3: '#E9E9EC',
          borde: '#E4E4E7',
          bordeFuerte: '#D4D4D8',
        },
        tinta: {
          DEFAULT: '#18181B',
          2: '#52525B',
          3: '#71717A',
          4: '#A1A1AA',
        },
        acento: { DEFAULT: '#2563EB', oscuro: '#1D4ED8', suave: '#EFF6FF', borde: '#BFDBFE' },
        vivo: { DEFAULT: '#16A34A', oscuro: '#15803D', suave: '#F0FDF4', borde: '#BBF7D0' },
        peligro: { DEFAULT: '#DC2626', oscuro: '#B91C1C', suave: '#FEF2F2', borde: '#FECACA' },
        alerta: { DEFAULT: '#B45309', suave: '#FFFBEB', borde: '#FDE68A' },
      },

      /**
       * Una sola escala de radios, con regla explícita:
       *   contenedores 12px · controles 8px · micro 6px · toggles pill.
       * Los nombres semánticos existen para que la regla se lea en el markup.
       */
      borderRadius: {
        card: '0.75rem',
        ctrl: '0.5rem',
        micro: '0.375rem',
      },

      /** Sombras tintadas con el neutro del panel, nunca negro puro. */
      boxShadow: {
        panel: '0 1px 2px 0 rgb(24 24 27 / 0.04), 0 1px 3px 0 rgb(24 24 27 / 0.06)',
        'panel-md': '0 2px 4px -1px rgb(24 24 27 / 0.05), 0 8px 24px -8px rgb(24 24 27 / 0.10)',
        'panel-lg': '0 8px 16px -4px rgb(24 24 27 / 0.08), 0 24px 48px -16px rgb(24 24 27 / 0.16)',
      },

      /** Escala de capas documentada: nada de z-50 al azar. */
      zIndex: { nav: '30', overlay: '40', dialog: '50' },

      maxWidth: {
        // Ancho de la columna del checkout. El de referencia es ~560px.
        checkout: '35rem',
        panel: '76rem',
      },

      fontFamily: {
        sans: [
          'var(--font-geist-sans)',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'var(--font-geist-mono)',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },

      keyframes: {
        'aparecer-abajo': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'aparecer-dialogo': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'aparecer-velo': { from: { opacity: '0' }, to: { opacity: '1' } },
        brillo: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        // Solo transform y opacity: nada que fuerce layout.
        'aparecer-abajo': 'aparecer-abajo 220ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'aparecer-dialogo': 'aparecer-dialogo 200ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'aparecer-velo': 'aparecer-velo 160ms ease-out both',
        brillo: 'brillo 1.6s infinite',
      },
    },
  },
  plugins: [],
};

export default config;

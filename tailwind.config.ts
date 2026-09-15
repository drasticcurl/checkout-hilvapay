import type { Config } from 'tailwindcss';

/**
 * Dos paletas que nunca comparten pantalla, y por eso no se mezclan:
 *
 *  1. CHECKOUT (`comprar`, `urgencia`, `precio`, `borde`, `texto`) — los colores
 *     que ya vieron los compradores. Se conservan tal cual, CLAROS: cambiarlos
 *     metería una variable de conversión al mismo tiempo que el cambio de
 *     procesador y no se podría saber cuál de las dos movió el número. El panel
 *     pasó a dark (sesión 2026-09-15); el checkout NO — sigue siendo la parte
 *     que ve el comprador, verificada con tráfico real.
 *
 *  2. PANEL (`panel`, `tinta`, `acento`, `vivo`, `peligro`, `alerta`) — sistema
 *     propio, DARK. Neutros zinc invertidos con un acento por función. Lo mira
 *     una sola persona, todos los días, para apretar interruptores que cobran
 *     plata de verdad — dark reduce fatiga visual en sesiones largas y es lo que
 *     se pidió explícitamente.
 *
 * Cómo se reparte el color en el panel, y por qué (sin cambios de significado
 * respecto del modo claro anterior — solo los valores hex se invirtieron):
 *   · texto            → `tinta`, invertida: casi blanco sobre fondo casi negro.
 *   · acción primaria  → `acento` (antes era `tinta`/casi-negro: en dark un
 *                        neutro invertido a casi-blanco se confundiría con el
 *                        texto, así que la acción primaria pasa al acento).
 *   · `panel.solida`   → superficie sólida invertida (logo, monograma, el
 *                        círculo del paso "front" en el editor): reemplaza los
 *                        usos viejos de `bg-tinta` como fondo, que en dark ya
 *                        no puede ser "casi negro" porque tinta es el texto.
 *   · `acento` cobalto → interactivo: nav activo, links, foco, seleccionado,
 *                        Y AHORA la acción primaria.
 *   · `vivo` verde     → estado "cobrando de verdad", y nada más.
 *   · `peligro` rojo   → destructivo y errores, y nada más.
 *   · `alerta` ámbar   → advertencias que no bloquean.
 *
 * Cada acento tiene DOS tonos por la razón que un dark mode ingenuo pasa por
 * alto: el mismo hex que da buen contraste como TEXTO sobre un fondo oscuro
 * (~400 de la escala) NO da 4.5:1 con texto BLANCO encima cuando se lo usa como
 * fondo de botón sólido — hace falta un tono más oscuro (~600-700) para eso.
 *   · `DEFAULT` → texto, iconos, bordes de foco. Brillante.
 *   · `oscuro`  → fondo de botón sólido con texto blanco encima. Más oscuro.
 *   · `suave`   → fondo de insignia (tinte muy tenue del color sobre panel.sup).
 *   · `borde`   → borde de insignia.
 *
 * Contraste verificado con un script WCAG (sesión 2026-09-15), no a ojo:
 *   texto sobre panel.sup (#131316) → tinta 16.87:1 · tinta-2 7.85:1 ·
 *   tinta-3 4.87:1 · acento 7.29:1 · vivo 10.64:1 · peligro 6.70:1 · alerta 11.11:1.
 *   Todos pasan AA (≥4.5:1) salvo tinta-4, que NUNCA es texto (ver el límite de
 *   abajo).
 *   Blanco sobre el fondo de botón (`*.oscuro`) → acento 5.17:1 · vivo 5.02:1 ·
 *   peligro 4.83:1 · alerta 5.02:1. Todos pasan AA.
 *   Texto de acento sobre su propio `suave` (insignias) → acento 6.20:1 ·
 *   vivo 8.53:1 · peligro 5.84:1 · alerta 8.81:1. Todos pasan AA.
 *
 * Dos límites que hay que tener presentes al usar la paleta:
 *   · `tinta-3` sobre `panel-sup2` (el gris de las cabeceras y los campos
 *     deshabilitados) da 4.46:1 — al límite de AA. Si hace falta más margen,
 *     usar `tinta-2` en ese fondo.
 *   · `tinta-4` da 2.47:1 contra `panel.sup`: es para bordes en hover y para el
 *     punto de "apagado". Nunca para texto — igual que en el modo claro que
 *     reemplaza.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Checkout (SIN CAMBIOS — sigue claro, lo ve el comprador) ────────
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

        // ── Panel (DARK — sesión 2026-09-15) ────────────────────────────────
        panel: {
          fondo: '#0A0A0C',
          sup: '#131316',
          sup2: '#1C1C21',
          sup3: '#26262C',
          borde: '#26262C',
          bordeFuerte: '#34343B',
          // Superficie sólida invertida: reemplaza los `bg-tinta` de la era
          // clara (logo del header, botón de subir archivo, el círculo del
          // paso "front" en el editor). Casi blanco con texto oscuro encima —
          // es "el elemento de mayor peso visual", no el acento de marca.
          solida: '#F4F4F5',
        },
        tinta: {
          DEFAULT: '#F4F4F5',
          2: '#A8A8B0',
          3: '#82828B',
          4: '#54545C',
        },
        acento: {
          DEFAULT: '#60A5FA',
          oscuro: '#2563EB',
          hover: '#3B82F6',
          suave: '#192335',
          borde: '#213A64',
        },
        vivo: {
          DEFAULT: '#4ADE80',
          oscuro: '#15803D',
          hover: '#166534',
          suave: '#152C20',
          borde: '#18512F',
        },
        peligro: {
          DEFAULT: '#F87171',
          oscuro: '#DC2626',
          hover: '#B91C1C',
          suave: '#321A1C',
          borde: '#602426',
        },
        alerta: {
          DEFAULT: '#FBBF24',
          oscuro: '#B45309',
          hover: '#92400E',
          suave: '#332614',
          borde: '#624412',
        },
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

      /**
       * `panel`/`panel-md`/`panel-lg`: SIN CAMBIOS, valores del modo claro
       * original. Encontrado en la sesión 2026-09-15 al pasar el panel a dark:
       * `CheckoutContainer.tsx` (la card del checkout, que sigue claro) usa
       * `shadow-panel-md` — es una utilidad de Tailwind, no scopeada por
       * paleta, así que oscurecer estos tres nombres le rompía la sombra al
       * checkout sin que nadie lo hubiera pedido. El panel dark usa un set
       * PROPIO, con otro nombre (`sombra*`), para no volver a pisar esto.
       */
      boxShadow: {
        panel: '0 1px 2px 0 rgb(24 24 27 / 0.04), 0 1px 3px 0 rgb(24 24 27 / 0.06)',
        'panel-md': '0 2px 4px -1px rgb(24 24 27 / 0.05), 0 8px 24px -8px rgb(24 24 27 / 0.10)',
        'panel-lg': '0 8px 16px -4px rgb(24 24 27 / 0.08), 0 24px 48px -16px rgb(24 24 27 / 0.16)',
        /**
         * Sombras propias del panel dark (sesión 2026-09-15). Nombre distinto
         * a propósito (ver el comentario de arriba). Una sombra tintada con
         * negro casi no se distingue sobre un fondo ya oscuro, así que la
         * profundidad la da mayoritariamente un halo claro sutil (luz rasante
         * de una superficie elevada) más una sombra negra real pero más
         * marcada que en claro — el negro sigue siendo más oscuro que
         * `panel.sup`, así que sigue leyéndose.
         */
        sombra: '0 1px 2px 0 rgb(0 0 0 / 0.4), 0 0 0 1px rgb(255 255 255 / 0.04)',
        'sombra-md': '0 4px 12px -2px rgb(0 0 0 / 0.5), 0 0 0 1px rgb(255 255 255 / 0.05)',
        'sombra-lg': '0 12px 32px -8px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(255 255 255 / 0.06)',
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

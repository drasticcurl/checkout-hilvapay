/**
 * Layout raíz de `/admin`. Deliberadamente vacío de chrome propio: el nav vive
 * en `(panel)/layout.tsx`, que envuelve todo MENOS `/admin/login` — Next anida
 * layouts por carpeta física, así que separar login en un hermano de
 * `(panel)` (en vez de meterlo adentro) es lo que evita que la pantalla de
 * login muestre la navegación de las secciones que todavía no puede usar.
 *
 * SÍ tiene una responsabilidad propia (sesión 2026-09-15, panel a dark): el
 * `<body>` de `app/layout.tsx` es compartido con el checkout (`/pagos/[slug]`,
 * que sigue CLARO) y trae `bg-white`. Este div es lo que pisa ese fondo para
 * todo `/admin/*` — login incluido — sin tocar el layout raíz ni arriesgar el
 * fondo del checkout. `color-scheme: dark` va acá y no en `:root` por la misma
 * razón: si fuera global, el `<select>`/`<input type="checkbox">` nativos del
 * checkout (que sigue claro) se pintarían oscuros y quedarían ilegibles sobre
 * su fondo blanco — el mismo problema que el comentario viejo de globals.css
 * advertía, solo que ahora aplica en la dirección inversa.
 */
import type { ReactNode } from 'react';

export const metadata = {
  title: { default: 'Panel · Checkout', template: '%s · Panel' },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div data-panel-dark className="min-h-[100dvh] bg-panel-fondo text-tinta [color-scheme:dark]">
      {children}
    </div>
  );
}

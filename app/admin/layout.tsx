/**
 * Layout raíz de `/admin`. Deliberadamente vacío de chrome: el nav vive en
 * `(panel)/layout.tsx`, que envuelve todo MENOS `/admin/login` — Next anida
 * layouts por carpeta física, así que separar login en un hermano de
 * `(panel)` (en vez de meterlo adentro) es lo que evita que la pantalla de
 * login muestre la navegación de las secciones que todavía no puede usar.
 */
import type { ReactNode } from 'react';

export const metadata = {
  title: { default: 'Panel · Checkout', template: '%s · Panel' },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: ReactNode }): JSX.Element {
  return <>{children}</>;
}

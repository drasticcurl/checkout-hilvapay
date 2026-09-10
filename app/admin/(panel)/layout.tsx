/**
 * Shell de las pantallas protegidas del panel: header con la navegación entre
 * las cuatro secciones y el botón de salir. Vive en el route group `(panel)`
 * para no envolver `/admin/login`, que es hermano de esta carpeta y no hijo.
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { CerrarSesionButton } from './CerrarSesionButton';

const LINKS = [
  { href: '/admin', label: 'Links de pago' },
  { href: '/admin/catalogo', label: 'Catálogo de Whop' },
  { href: '/admin/productos', label: 'Productos' },
  { href: '/admin/origenes', label: 'Orígenes' },
  { href: '/admin/cobros', label: 'Cobros' },
];

export default function PanelLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-borde">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <nav className="flex flex-wrap items-center gap-1" aria-label="Secciones del panel">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-texto-suave transition-colors hover:bg-gray-100 hover:text-texto"
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <CerrarSesionButton />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}

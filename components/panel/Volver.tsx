import Link from 'next/link';
import { ArrowLeft } from '@phosphor-icons/react/ssr';

/**
 * El camino de vuelta. Las pantallas de formulario (`/nuevo`, `/[id]`) eran
 * callejones sin salida: se entraba desde una tabla y la única forma de volver
 * era el botón del navegador o guardar. Un panel donde salir de una pantalla
 * exige guardar es un panel que empuja a guardar cosas a medias.
 */
export function Volver({ href, children }: { href: string; children: string }): JSX.Element {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-micro text-[13px] font-medium text-tinta-2 transition-colors duration-150 hover:text-tinta"
    >
      <ArrowLeft size={13} aria-hidden="true" />
      {children}
    </Link>
  );
}

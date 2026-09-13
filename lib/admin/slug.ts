/**
 * Normalización de slugs. Puro: sin `db`, sin `pg`, sin ningún import de Node
 * (`fs`, `net`, `tls`, `dns`).
 *
 * Vivía en `lib/admin/paginas.ts` hasta que `lib/admin/integracion.ts` empezó a
 * necesitarla para `generarSlugConSufijo` (módulo `panel-catalogo-funnels`,
 * T01). `paginas.ts` importa `../db`, que importa `pg` — un módulo server-only
 * que arrastra `fs`/`net`/`tls`/`dns` al bundle. `integracion.ts` lo importan
 * componentes `'use client'` (`EditorFunnel.tsx`, para los snippets), así que
 * cualquier cosa que `integracion.ts` importe termina en el bundle del browser.
 * Con `normalizarSlug` todavía en `paginas.ts`, `next build` fallaba con
 * "Module not found: fs/net/tls/dns" — confirmado en la ejecución real de la
 * ola 2 de ese módulo, por cuatro agentes de forma independiente.
 *
 * `paginas.ts` sigue re-exportando `normalizarSlug` desde acá (ver el final de
 * ese archivo) para no romper ningún import existente — es un movimiento de
 * ubicación, no un cambio de API.
 */

/**
 * Normaliza un slug: minúsculas, sin acentos, espacios y guion bajo a guion
 * medio, solo `[a-z0-9-]`, sin guiones repetidos ni al borde.
 */
export function normalizarSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita los diacríticos, deja la letra base
    .replace(/[\s_]+/g, '-') // espacios y guion bajo → guion medio
    .replace(/[^a-z0-9-]/g, '') // descarta todo lo que no sea a-z0-9-
    .replace(/-+/g, '-') // colapsa guiones repetidos
    .replace(/^-+|-+$/g, ''); // recorta guiones al borde
}

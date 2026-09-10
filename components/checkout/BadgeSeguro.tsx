import { ShieldCheck } from '@phosphor-icons/react/ssr';

/**
 * La barra "100% SEGURO". `config.badgeSeguro` la apaga.
 *
 * El escudo es un SVG y no el emoji 🛡 que había antes: un emoji lo dibuja el
 * sistema operativo, así que `text-comprar` no lo pintaba de verde —salía del
 * color que tuviera la fuente de emoji del dispositivo, distinto en cada
 * teléfono— y encima cambiaba de forma entre Android y iOS. Un sello de
 * seguridad que se ve distinto en cada visita no tranquiliza a nadie.
 *
 * Alineado a la IZQUIERDA y en texto oscuro, no centrado y gris: es el primer
 * elemento que se lee después del timer. La línea de abajo lo separa de la ficha
 * del producto, igual que en el checkout de referencia.
 */
export function BadgeSeguro() {
  return (
    <div className="flex items-center gap-2 border-b border-borde px-4 py-2.5">
      <ShieldCheck size={16} weight="fill" className="shrink-0 text-comprar-boton" aria-hidden="true" />
      <span className="text-[13px] font-bold tracking-[0.01em] text-texto">100% SEGURO</span>
    </div>
  );
}

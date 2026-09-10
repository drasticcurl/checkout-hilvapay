/** La barra "🛡 100% SEGURO" de la captura de KashPay. `config.badgeSeguro` la apaga. */
export function BadgeSeguro() {
  return (
    // Alineado a la IZQUIERDA y en texto oscuro, no centrado y gris: es el
    // primer elemento que se lee después del timer, y un sello de seguridad
    // apagado no tranquiliza a nadie. La línea de abajo separa esta barra de la
    // ficha del producto, igual que en el checkout que se está reemplazando.
    <div className="flex items-center gap-1.5 border-b border-borde px-4 py-2.5 text-xs font-bold text-texto">
      <span className="text-comprar" aria-hidden="true">🛡</span>
      <span>100% SEGURO</span>
    </div>
  );
}

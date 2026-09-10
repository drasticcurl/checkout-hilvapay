/** La barra "🛡 100% SEGURO" de la captura de KashPay. `config.badgeSeguro` la apaga. */
export function BadgeSeguro() {
  return (
    <div className="flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-texto-suave">
      <span aria-hidden="true">🛡</span>
      <span>100% SEGURO</span>
    </div>
  );
}

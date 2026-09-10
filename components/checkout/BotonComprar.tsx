/**
 * El botón verde propio. Dispara el submit del iframe, no un submit propio:
 * el server nunca ve los datos de tarjeta, eso vive enteramente en el embed.
 */
export function BotonComprar({
  texto,
  disabled,
  cargando,
  onClick,
}: {
  texto: string;
  disabled: boolean;
  cargando: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || cargando}
      onClick={onClick}
      className="w-full rounded-md bg-comprar py-3 text-center font-bold text-white transition-colors hover:bg-comprar-oscuro disabled:cursor-not-allowed disabled:bg-borde disabled:text-texto-suave"
    >
      {cargando ? 'Procesando…' : texto}
    </button>
  );
}

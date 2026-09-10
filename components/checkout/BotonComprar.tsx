/**
 * El botón verde propio. Dispara el submit del iframe, no un submit propio:
 * el server nunca ve los datos de tarjeta, eso vive enteramente en el embed.
 *
 * Usa `comprar-boton` (#15803D) y no `comprar` (#16A34A). Con el verde claro,
 * texto blanco de 16px da 3.3:1 y no llega al mínimo AA de 4.5:1 — o sea que en
 * un teléfono al sol la etiqueta del botón más importante de la página se
 * volvía difícil de leer. Con este tono da 5.0:1 y además es el verde de la
 * captura de referencia, que es un poco más oscuro que el token viejo.
 *
 * `active:translate-y-px` es el empujón físico del click. En el botón que cobra
 * es donde más importa: confirma que el toque entró antes de que aparezca
 * "Procesando…".
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
      className="w-full rounded-lg bg-comprar-boton py-4 text-center text-base font-bold text-white transition-[background-color,transform] duration-150 hover:bg-comprar-botonHover active:translate-y-px disabled:cursor-not-allowed disabled:bg-borde disabled:text-texto-suave disabled:active:translate-y-0"
    >
      {cargando ? 'Procesando…' : texto}
    </button>
  );
}

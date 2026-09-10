/**
 * Nombre y email en HTML propio, arriba del embed. En modo recuperación
 * (`?ot=&r=1`) no se renderizan: esos datos ya se conocen de la orden.
 *
 * Los inputs miden 48px de alto: es el tamaño del checkout de referencia y es lo
 * que hace que se puedan tocar con el pulgar sin apuntar. El anillo de foco no
 * está en la referencia y va igual — un formulario de pago que no se puede
 * navegar con teclado no es aceptable, y a 4px al 10% de opacidad no compite con
 * nada.
 */
const CAMPO =
  'h-12 w-full rounded-lg border border-borde bg-white px-3.5 text-[15px] text-texto ' +
  'placeholder:text-texto-suave/70 outline-none transition-[border-color,box-shadow] ' +
  'focus:border-precio focus:ring-4 focus:ring-precio/10 ' +
  'disabled:cursor-not-allowed disabled:bg-borde/40 disabled:text-texto-suave';

export function CamposComprador({
  nombre,
  email,
  onNombreChange,
  onEmailChange,
  disabled,
}: {
  nombre: string;
  email: string;
  onNombreChange: (v: string) => void;
  onEmailChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="nombre" className="text-[13px] text-texto">
          Nombre completo
        </label>
        <input
          id="nombre"
          name="nombre"
          type="text"
          autoComplete="name"
          value={nombre}
          disabled={disabled}
          onChange={(e) => onNombreChange(e.target.value)}
          className={CAMPO}
          placeholder="Escribí tu nombre completo"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-[13px] text-texto">
          E-mail*
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          disabled={disabled}
          onChange={(e) => onEmailChange(e.target.value)}
          className={CAMPO}
          placeholder="E-mail*"
        />
      </div>
    </div>
  );
}

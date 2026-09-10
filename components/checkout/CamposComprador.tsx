/**
 * Nombre y email en HTML propio, arriba del embed. En modo recuperación
 * (`?ot=&r=1`) no se renderizan: esos datos ya se conocen de la orden.
 */
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="nombre" className="text-sm font-medium text-texto">
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
          className="rounded-md border border-borde px-3 py-2 text-texto outline-none focus:border-precio disabled:bg-gray-50"
          placeholder="Tu nombre completo"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium text-texto">
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
          className="rounded-md border border-borde px-3 py-2 text-texto outline-none focus:border-precio disabled:bg-gray-50"
          placeholder="tu@email.com"
        />
      </div>
    </div>
  );
}

import { formatearPrecio } from './utils';

/**
 * Card del producto: imagen, nombre real (nunca el "nombre soft" de Whop) y
 * precio. Es HTML propio, réplica de la captura de KashPay — no hay nada acá
 * que salga del embed.
 */
export function CardProducto({
  nombre,
  imagenUrl,
  precio,
  precioAnclaje,
  moneda,
  subtitulo,
}: {
  nombre: string;
  imagenUrl: string | null;
  precio: string;
  precioAnclaje: string | null;
  moneda: string;
  subtitulo?: string;
}) {
  return (
    // Sin caja con borde: en el checkout de referencia es una fila con una línea
    // separadora abajo, no una tarjeta. Menos marcos hacen que el ojo vaya a los
    // campos, que es lo único que hay que completar.
    <div className="flex items-center gap-3 border-b border-borde pb-4">
      {imagenUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- imagen remota configurable desde el panel, sin dominio fijo para next/image
        <img src={imagenUrl} alt={nombre} className="h-14 w-14 shrink-0 rounded-md object-cover" />
      ) : (
        <div className="h-14 w-14 shrink-0 rounded-md bg-borde" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        {subtitulo ? <p className="text-sm text-texto-suave">{subtitulo}</p> : null}
        <p className="text-sm font-bold leading-snug text-texto">{nombre}</p>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="text-xl font-bold text-precio">{formatearPrecio(precio, moneda)}</span>
          {precioAnclaje ? (
            <span className="text-sm text-texto-suave line-through">{formatearPrecio(precioAnclaje, moneda)}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

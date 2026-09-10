/**
 * `/admin/conexion` — contra qué cuenta de Whop está apuntando el servicio, y
 * cómo cambiarlo sin entrar por SSH.
 *
 * No es un ítem del nav: se llega por el engranaje del header, al lado del
 * indicador de entorno. Es una pantalla de configuración que se toca dos veces
 * por año, y la barra ya tiene ocho secciones de uso diario — un noveno ítem
 * empujaría la fila de una línea por encima del ancho del contenedor.
 */
import { Warning, WarningCircle } from '@phosphor-icons/react/ssr';
import { estadoCredenciales } from '../../../../lib/whop-credenciales';
import {
  Aviso,
  Codigo,
  EncabezadoPantalla,
  Insignia,
  Tarjeta,
} from '../../../../components/panel/ui';
import { FormularioCredenciales } from './FormularioCredenciales';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
      <dt className="text-[13px] text-tinta-2">{etiqueta}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

export default async function ConexionPage(): Promise<JSX.Element> {
  const estado = await estadoCredenciales();
  const enProduccion = estado.base.includes('api.whop.com');

  return (
    <div className="max-w-2xl space-y-6">
      <EncabezadoPantalla
        titulo="Conexión con Whop"
        descripcion="Las credenciales con las que este servicio cobra. Se verifican contra Whop antes de guardarse, y la API key queda cifrada en la base."
      />

      {estado.problema ? (
        <Aviso
          tono="peligro"
          rol="alert"
          icono={<WarningCircle size={17} aria-hidden="true" />}
          titulo="Revisá esto"
        >
          {estado.problema}
        </Aviso>
      ) : null}

      <Tarjeta className="px-5 py-3">
        <dl className="divide-y divide-panel-borde">
          <Dato etiqueta="De dónde salen">
            <Insignia tono={estado.fuente === 'base' ? 'acento' : 'neutro'}>
              {estado.fuente === 'base' ? 'panel' : 'variables de entorno'}
            </Insignia>
          </Dato>
          {estado.companyNombre ? (
            <Dato etiqueta="Cuenta">
              <span className="text-[13px] font-medium text-tinta">{estado.companyNombre}</span>
            </Dato>
          ) : null}
          <Dato etiqueta="Company id">
            <Codigo>{estado.companyId || 'sin configurar'}</Codigo>
          </Dato>
          <Dato etiqueta="API key">
            <Codigo>{estado.apiKeyEnmascarada}</Codigo>
          </Dato>
          <Dato etiqueta="Entorno">
            <Insignia tono={enProduccion ? 'alerta' : 'neutro'}>
              {enProduccion ? 'producción' : 'sandbox'}
            </Insignia>
          </Dato>
          <Dato etiqueta="Api-Version-Date">
            <Codigo>{estado.versionDate || 'sin configurar'}</Codigo>
          </Dato>
          {estado.verificadoAt ? (
            <Dato etiqueta="Verificadas">
              <span className="font-mono text-[12px] tabular-nums text-tinta-2">
                {new Date(estado.verificadoAt).toLocaleString('es-AR')}
              </span>
            </Dato>
          ) : null}
        </dl>
      </Tarjeta>

      <FormularioCredenciales estado={estado} />

      {/* El camino de vuelta cuando el panel ya no puede hablar con Whop y por lo
          tanto tampoco puede arreglarse desde el panel. Vale escribirlo acá y no
          solo en la documentación: es justo lo que se necesita en el peor momento. */}
      <Aviso tono="acento" icono={<Warning size={16} aria-hidden="true" />} titulo="Si te quedás afuera">
        Las variables de entorno siguen siendo el piso: si lo que se guarda acá deja de funcionar, borrar
        el override devuelve el servicio a <span className="font-mono">WHOP_API_KEY</span> y compañía. Si
        ni eso alcanza, se editan los dos <span className="font-mono">.env.production</span> de la VPS
        (el de <span className="font-mono">shared/</span> y la copia de la release viva) y se recarga PM2.
      </Aviso>
    </div>
  );
}

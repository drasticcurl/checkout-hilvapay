/**
 * `/admin/numeros` — cuánto entró, qué proporción se aprueba y qué hace cada
 * paso del funnel.
 *
 * Es la pantalla que faltaba: el panel tenía links, productos, funnels y la lista
 * cruda de cobros, y ni un solo importe sumado. Todo sale de `cobros`; no le pega
 * a la API de Whop (ver el encabezado de `lib/admin/metricas.ts`).
 *
 * La ventana se elige por querystring (`?v=7d`) y no con estado de cliente: así
 * la pantalla sigue siendo un server component que consulta y renderiza, y el
 * link a "los últimos 30 días" se puede compartir o dejar en un favorito.
 */
import Link from 'next/link';
import { ChartLineUp, Warning } from '@phosphor-icons/react/ssr';
import { declinesFrecuentes, porPaso, resumen, type BrutoMoneda } from '../../../../lib/admin/metricas';
import {
  Aviso,
  Codigo,
  EncabezadoPantalla,
  EstadoVacio,
  Insignia,
  SinDato,
  TablaEnvoltorio,
  Tarjeta,
  Td,
  Th,
  Tr,
  unir,
} from '../../../../components/panel/ui';

export const dynamic = 'force-dynamic';

const VENTANAS = {
  '24h': { horas: 24, etiqueta: 'Últimas 24 h' },
  '7d': { horas: 24 * 7, etiqueta: 'Últimos 7 días' },
  '30d': { horas: 24 * 30, etiqueta: 'Últimos 30 días' },
} as const;

type ClaveVentana = keyof typeof VENTANAS;

function esClaveVentana(v: string | undefined): v is ClaveVentana {
  return v === '24h' || v === '7d' || v === '30d';
}

function plata(lista: BrutoMoneda[]): string {
  if (lista.length === 0) return '0.00';
  return lista.map((b) => `${Number(b.total).toFixed(2)} ${b.moneda.toUpperCase()}`).join(' · ');
}

function porcentaje(valor: number | null): string {
  if (valor === null) return '—';
  return `${(valor * 100).toFixed(0)}%`;
}

/**
 * Tarjeta de métrica. Vive acá y no en `components/panel/ui.tsx` a propósito: en
 * el resto del panel los números van como frase dentro del encabezado ("3 de 5
 * links están cobrando"), y esta forma es solo de esta pantalla. Subirla a las
 * primitivas invitaría a llenar las otras de tarjetas de métrica, que es el look
 * de dashboard genérico que el panel evita.
 */
function Metrica({
  etiqueta,
  valor,
  nota,
  destacada,
}: {
  etiqueta: string;
  valor: string;
  nota?: string;
  destacada?: boolean;
}): JSX.Element {
  return (
    <Tarjeta className="p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-tinta-3">{etiqueta}</p>
      <p
        className={unir(
          'mt-1.5 font-mono tabular-nums tracking-[-0.02em] text-tinta',
          destacada ? 'text-2xl font-semibold' : 'text-xl',
        )}
      >
        {valor}
      </p>
      {nota ? <p className="mt-1 text-[12px] leading-relaxed text-tinta-3">{nota}</p> : null}
    </Tarjeta>
  );
}

export default async function NumerosPage({
  searchParams,
}: {
  searchParams: { v?: string };
}): Promise<JSX.Element> {
  const clave: ClaveVentana = esClaveVentana(searchParams.v) ? searchParams.v : '7d';
  const { horas, etiqueta } = VENTANAS[clave];

  const [r, pasos, declines] = await Promise.all([
    resumen(horas),
    porPaso(horas),
    declinesFrecuentes(horas),
  ]);

  const hayDatos = r.intentos > 0 || r.ordenesIniciadas > 0;

  return (
    <div className="space-y-6">
      <EncabezadoPantalla
        titulo="Números"
        descripcion={`${etiqueta}. Todo sale de los cobros registrados acá, no de Whop.`}
        acciones={
          <div className="flex items-center gap-1">
            {(Object.keys(VENTANAS) as ClaveVentana[]).map((k) => (
              <Link
                key={k}
                href={`/admin/numeros?v=${k}`}
                aria-current={k === clave ? 'page' : undefined}
                className={unir(
                  'rounded-ctrl px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150',
                  k === clave
                    ? 'bg-acento-suave text-acento-oscuro'
                    : 'text-tinta-2 hover:bg-panel-sup2 hover:text-tinta',
                )}
              >
                {k}
              </Link>
            ))}
          </div>
        }
      />

      {!hayDatos ? (
        <EstadoVacio
          icono={<ChartLineUp size={20} aria-hidden="true" />}
          titulo="Todavía no hay nada que contar"
          descripcion="En cuanto alguien abra un link de pago y se dispare un cobro, acá aparecen el bruto, la tasa de aprobación y el rendimiento de cada paso del funnel."
        />
      ) : (
        <>
          {r.sinResolver > 0 ? (
            <Aviso tono="alerta" icono={<Warning size={16} aria-hidden="true" />}>
              {r.sinResolver} cobro(s) sin resolver en esta ventana. No cuentan ni como venta ni como
              rechazo: están esperando que el webhook o la reconciliación los cierren.
            </Aviso>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metrica
              etiqueta="Bruto cobrado"
              valor={plata(r.brutoPorMoneda)}
              nota={`${r.pagados} cobro(s) pagados`}
              destacada
            />
            <Metrica
              etiqueta="Neto"
              valor={plata(r.netoPorMoneda)}
              nota={
                r.reembolsos > 0
                  ? `${r.reembolsos} reembolso(s) descontados`
                  : 'sin reembolsos en la ventana'
              }
            />
            <Metrica
              etiqueta="Aprobación"
              valor={porcentaje(r.aprobacion)}
              nota={`${r.pagados} de ${r.pagados + r.rechazados} resueltos`}
            />
            <Metrica
              etiqueta="Conversión del checkout"
              valor={porcentaje(r.conversionCheckout)}
              nota={`${r.frontPagados} pagaron de ${r.ordenesIniciadas} que empezaron`}
            />
          </div>

          {r.disputas > 0 ? (
            <Aviso tono="peligro" icono={<Warning size={16} aria-hidden="true" />}>
              {r.disputas} disputa(s) en esta ventana. Una disputa tiene plazo de respuesta y se resuelve
              en el dashboard de Whop.
            </Aviso>
          ) : null}

          <div className="space-y-3">
            <h2 className="text-[13px] font-semibold text-tinta">Cada paso</h2>
            <TablaEnvoltorio>
              <thead>
                <tr>
                  <Th>Funnel</Th>
                  <Th>Paso</Th>
                  <Th>Producto</Th>
                  <Th numerica>Intentos</Th>
                  <Th numerica>Pagados</Th>
                  <Th numerica>Take-rate</Th>
                  <Th numerica>Bruto</Th>
                </tr>
              </thead>
              <tbody>
                {pasos.map((p) => {
                  const take = p.intentos > 0 ? p.pagados / p.intentos : null;
                  return (
                    <Tr key={p.pagina_id}>
                      <Td className="text-tinta-2">{p.funnel_nombre ?? <SinDato />}</Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Codigo>{p.slug}</Codigo>
                          <Insignia tono={p.tipo === 'front' ? 'acento' : 'neutro'}>{p.tipo}</Insignia>
                        </div>
                      </Td>
                      <Td className="max-w-[14rem] truncate font-medium">{p.producto_nombre}</Td>
                      <Td numerica>{p.intentos}</Td>
                      <Td numerica>{p.pagados}</Td>
                      {/* Un take-rate sin intentos no es 0%: es "no se midió". */}
                      <Td numerica>{take === null ? <SinDato /> : porcentaje(take)}</Td>
                      <Td numerica className="whitespace-nowrap">
                        {Number(p.bruto) === 0
                          ? <SinDato />
                          : `${Number(p.bruto).toFixed(2)} ${(p.moneda ?? '').toUpperCase()}`}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </TablaEnvoltorio>
          </div>

          {declines.length > 0 ? (
            <div className="space-y-3">
              <h2 className="text-[13px] font-semibold text-tinta">Por qué rebotaron</h2>
              <p className="max-w-[65ch] text-[13px] leading-relaxed text-tinta-2">
                Un solo código repitiéndose casi siempre es configuración, no tarjetas: un plan mal
                asociado devuelve el mismo motivo en todos los intentos.
              </p>
              <TablaEnvoltorio>
                <thead>
                  <tr>
                    <Th>Código de rechazo</Th>
                    <Th numerica>Veces</Th>
                  </tr>
                </thead>
                <tbody>
                  {declines.map((d) => (
                    <Tr key={d.decline_code}>
                      <Td>
                        <span className="font-mono text-[12px] text-peligro-oscuro">{d.decline_code}</span>
                      </Td>
                      <Td numerica>{d.veces}</Td>
                    </Tr>
                  ))}
                </tbody>
              </TablaEnvoltorio>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

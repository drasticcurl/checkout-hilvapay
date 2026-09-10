'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowsClockwise, Warning } from '@phosphor-icons/react/ssr';
import type { PlanDelCatalogo } from '../../../../lib/admin/catalogo';
import {
  Boton,
  Codigo,
  EstadoVivo,
  Insignia,
  clasesBoton,
} from '@/components/panel/ui';
import { FormularioVincular } from './FormularioVincular';

type Props = {
  plan: PlanDelCatalogo;
  whopProductId: string | null;
  nombreSoft: string | null;
};

/**
 * Una fila de plan en el catálogo. Tres estados posibles y cada uno muestra algo
 * distinto:
 *
 *  - ya vinculado  → el nombre local y sus links, con el estado de cada uno
 *  - huérfano      → advertencia, porque vincularlo casi siempre es un error
 *  - libre         → el botón de vincular
 */
export function FilaPlan({ plan, whopProductId, nombreSoft }: Props): JSX.Element {
  const [abierto, setAbierto] = useState(false);

  const esRenewal = plan.plan_type !== 'one_time';

  return (
    <li className="border-b border-panel-borde px-4 py-3.5 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold tabular-nums text-tinta">
              {plan.precio} {plan.moneda.toUpperCase()}
            </span>
            <Insignia
              tono={esRenewal ? 'peligro' : 'neutro'}
              icono={esRenewal ? <ArrowsClockwise size={11} aria-hidden="true" /> : undefined}
            >
              {plan.plan_type}
            </Insignia>
            {plan.visibility ? <Insignia tono="neutro">{plan.visibility}</Insignia> : null}
          </div>

          <Codigo className="block max-w-full truncate">{plan.plan_id}</Codigo>

          {esRenewal ? (
            <div className="flex gap-2 rounded-ctrl border border-peligro-borde bg-peligro-suave px-3 py-2">
              <Warning size={15} className="mt-px shrink-0 text-peligro" aria-hidden="true" />
              <p className="text-[12px] leading-relaxed text-peligro-oscuro">
                Este plan es una suscripción: Whop le va a cobrar de nuevo al comprador el período
                siguiente, solo, sin que este checkout intervenga. Si querés un pago único, cambialo en
                el dashboard de Whop antes de vincularlo.
              </p>
            </div>
          ) : null}

          {plan.huerfano ? (
            <p className="text-[12px] leading-relaxed text-tinta-3">
              No está atado a ningún producto de Whop. Un plan así no admite códigos de descuento.
            </p>
          ) : null}
        </div>

        <div className="shrink-0">
          {plan.vinculado ? (
            <div className="space-y-1.5 text-right">
              <p className="text-[13px] font-medium text-tinta">{plan.vinculado.nombre}</p>
              {plan.vinculado.paginas.length === 0 ? (
                <p className="text-[12px] text-tinta-3">Vinculado, sin link todavía</p>
              ) : (
                <ul className="space-y-1">
                  {plan.vinculado.paginas.map((pg) => (
                    <li key={pg.slug} className="flex items-center justify-end gap-2">
                      <span className="font-mono text-[12px] text-tinta-2">/pagos/{pg.slug}</span>
                      <EstadoVivo activo={pg.activo} />
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href={`/admin/productos/${plan.vinculado.producto_id}`}
                className={clasesBoton('secundario', 'sm')}
              >
                Editar producto
              </Link>
            </div>
          ) : abierto ? null : (
            <Boton variante="primario" tamano="sm" onClick={() => setAbierto(true)}>
              Vincular
            </Boton>
          )}
        </div>
      </div>

      {abierto && !plan.vinculado ? (
        <FormularioVincular
          plan={plan}
          whopProductId={whopProductId}
          nombreSoft={nombreSoft}
          onCancelar={() => setAbierto(false)}
        />
      ) : null}
    </li>
  );
}

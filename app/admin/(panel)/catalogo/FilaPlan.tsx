'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { PlanDelCatalogo } from '../../../../lib/admin/catalogo';
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
    <li className="border-b border-borde px-4 py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-texto">
              {plan.precio} {plan.moneda.toUpperCase()}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                esRenewal ? 'bg-urgencia/10 text-urgencia' : 'bg-gray-100 text-texto-suave'
              }`}
            >
              {plan.plan_type}
            </span>
            {plan.visibility ? (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-texto-suave">
                {plan.visibility}
              </span>
            ) : null}
          </div>
          <code className="mt-0.5 block truncate text-xs text-texto-suave">{plan.plan_id}</code>

          {esRenewal ? (
            <p className="mt-1 text-xs font-medium text-urgencia">
              Este plan es una suscripción: Whop le va a cobrar de nuevo al comprador el período
              siguiente, solo, sin que este checkout intervenga. Si querés un pago único, cambialo en el
              dashboard de Whop antes de vincularlo.
            </p>
          ) : null}

          {plan.huerfano ? (
            <p className="mt-1 text-xs text-texto-suave">
              No está atado a ningún producto de Whop. Un plan así no admite códigos de descuento.
            </p>
          ) : null}
        </div>

        <div className="shrink-0">
          {plan.vinculado ? (
            <div className="text-right text-sm">
              <p className="font-medium text-texto">{plan.vinculado.nombre}</p>
              {plan.vinculado.paginas.length === 0 ? (
                <p className="text-xs text-texto-suave">vinculado, sin link todavía</p>
              ) : (
                <ul className="text-xs">
                  {plan.vinculado.paginas.map((pg) => (
                    <li key={pg.slug} className="text-texto-suave">
                      /pagos/{pg.slug}{' '}
                      <span className={pg.activo ? 'font-medium text-comprar' : ''}>
                        {pg.activo ? 'activo' : 'apagado'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href={`/admin/productos/${plan.vinculado.producto_id}`}
                className="text-xs font-medium text-precio hover:underline"
              >
                Editar
              </Link>
            </div>
          ) : abierto ? null : (
            <button
              type="button"
              onClick={() => setAbierto(true)}
              className="rounded-md border border-comprar px-3 py-1.5 text-sm font-semibold text-comprar transition-colors hover:bg-comprar hover:text-white"
            >
              Vincular
            </button>
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

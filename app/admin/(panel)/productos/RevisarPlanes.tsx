'use client';

import { useState } from 'react';
import { ArrowsClockwise, CheckCircle, Warning, XCircle } from '@phosphor-icons/react/ssr';
import type { PlanRevisado } from '@/lib/admin/planes';
import { Aviso, Boton, Codigo, Insignia } from '@/components/panel/ui';

type Respuesta =
  | {
      ok: true;
      companyActiva: string;
      fuenteCredenciales: 'base' | 'entorno';
      hayProblemas: boolean;
      revisados: PlanRevisado[];
    }
  | { ok: false; motivo: string };

/**
 * "Revisar los planes contra Whop": confirma que el plan de cada producto sea de
 * la cuenta que cobra.
 *
 * Es un botón y no un chequeo automático al cargar la pantalla porque son N
 * llamadas a la API de Whop —una por producto— para un dato que cambia cuando se
 * rota la cuenta, o sea casi nunca.
 *
 * ── Qué problema resuelve ───────────────────────────────────────────────────
 * Rotar la cuenta de Whop desde `/admin/conexion` no mueve los `whop_plan_id` de
 * los productos, que siguen apuntando a la cuenta vieja. Pasó en producción el
 * 2026-09-11: dos de cuatro productos quedaron apuntando a `biz_Me8Lbiv174brtM`
 * cuando la que cobra pasó a ser `biz_LHktpJ17c83CFt`.
 *
 * Y era invisible: `GET /plans/{id}` devuelve **200** para un plan de otra
 * company, así que la pantalla mostraba los cuatro iguales. Lo único que
 * cambiaba era que cobrar con dos de ellos fallaba, con el 400 genérico de Whop
 * que no menciona companies. Una hora de diagnóstico.
 */
export function RevisarPlanes(): JSX.Element {
  const [estado, setEstado] = useState<'inicial' | 'cargando' | 'listo'>('inicial');
  const [resp, setResp] = useState<Respuesta | null>(null);

  async function revisar(): Promise<void> {
    setEstado('cargando');
    try {
      const r = await fetch('/api/admin/productos/revisar-planes');
      setResp((await r.json()) as Respuesta);
    } catch {
      setResp({ ok: false, motivo: 'No se pudo conectar con el servidor.' });
    } finally {
      setEstado('listo');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Boton
          variante="secundario"
          tamano="sm"
          onClick={revisar}
          disabled={estado === 'cargando'}
          icono={<ArrowsClockwise size={14} aria-hidden="true" />}
        >
          {estado === 'cargando' ? 'Revisando...' : 'Revisar los planes contra Whop'}
        </Boton>
        {resp?.ok ? (
          <span className="text-[12px] text-tinta-3">
            Cuenta que cobra: <Codigo>{resp.companyActiva}</Codigo>{' '}
            {resp.fuenteCredenciales === 'base' ? '(del panel)' : '(del entorno)'}
          </span>
        ) : null}
      </div>

      {resp && !resp.ok ? (
        <Aviso tono="alerta" icono={<Warning size={15} aria-hidden="true" />}>
          {resp.motivo}
        </Aviso>
      ) : null}

      {resp?.ok ? (
        <>
          {resp.hayProblemas ? (
            <Aviso
              tono="peligro"
              icono={<Warning size={15} aria-hidden="true" />}
              titulo="Hay productos que NO van a poder cobrar"
            >
              Su plan no pertenece a la cuenta de Whop que está cobrando. El cobro va a fallar con un
              error genérico que no menciona esto, así que conviene arreglarlo antes de encender el
              link. Lo más rápido es volver a vincularlos desde <Codigo>/admin/catalogo</Codigo>, que
              solo ofrece planes de la cuenta activa.
            </Aviso>
          ) : (
            <Aviso tono="vivo" icono={<CheckCircle size={15} aria-hidden="true" />}>
              Todos los planes pertenecen a la cuenta que cobra.
            </Aviso>
          )}

          <ul className="space-y-1.5">
            {resp.revisados.map((r) => (
              <li key={r.productoId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                {r.estado === 'coincide' ? (
                  <CheckCircle size={14} className="shrink-0 text-vivo-oscuro" aria-hidden="true" />
                ) : r.estado === 'indeterminado' ? (
                  <Warning size={14} className="shrink-0 text-alerta" aria-hidden="true" />
                ) : (
                  <XCircle size={14} className="shrink-0 text-peligro" aria-hidden="true" />
                )}
                <span className="max-w-[18rem] truncate font-medium text-tinta">{r.productoNombre}</span>
                <Codigo className="max-w-[14rem] truncate">{r.whopPlanId}</Codigo>

                {r.estado === 'otra_company' ? (
                  <>
                    <Insignia tono="peligro">otra cuenta</Insignia>
                    <span className="text-tinta-3">
                      es de <Codigo>{r.companyDelPlan}</Codigo>
                    </span>
                  </>
                ) : null}
                {r.estado === 'no_existe' ? (
                  <Insignia tono="peligro">Whop no lo encuentra</Insignia>
                ) : null}
                {r.estado === 'indeterminado' ? (
                  <>
                    <Insignia tono="alerta">no se pudo chequear</Insignia>
                    {r.detalle ? <span className="text-tinta-3">{r.detalle}</span> : null}
                  </>
                ) : null}
                {/* El desfasaje de precio se informa pero NO se marca como problema:
                    se puede querer mostrar un precio y cobrar otro. Casi siempre es
                    un descuido, y casi nunca es urgente. */}
                {r.estado === 'coincide' && r.precioWhop && r.precioWhop !== Number(r.precioLocal).toFixed(2) ? (
                  <span className="text-tinta-3">
                    acá dice {Number(r.precioLocal).toFixed(2)}, en Whop {r.precioWhop}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

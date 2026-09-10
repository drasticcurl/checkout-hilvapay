'use client';

/**
 * "Cómo conectarlo a tu funnel" — el código exacto para pegar en el repo del
 * funnel, generado a partir de los slugs reales de este funnel.
 *
 * Es una pantalla de instrucciones y aun así no dice "reemplazá <SLUG> por el
 * slug de tu paso": eso es lo que hace que alguien pegue el slug del upsell 2 en
 * el botón del upsell 1 y cobre el producto equivocado sin ningún error visible.
 * Los slugs ya vienen puestos. Lo único que el usuario hace es copiar.
 *
 * Vive en `components/panel/` y no en `app/admin/(panel)/funnels/` porque la usan
 * dos pantallas: la del funnel (con sus pasos) y la de orígenes (solo el paso 1,
 * como referencia después de autorizar un dominio).
 */

import { useEffect, useRef, useState } from 'react';
import {
  ArrowSquareOut,
  Check,
  Copy,
  Info,
  Warning,
} from '@phosphor-icons/react/ssr';
import type { Integracion } from '@/lib/admin/integracion';
import { Aviso, Codigo, Insignia, Tarjeta, unir } from '@/components/panel/ui';

/**
 * Bloque de código con botón de copiar.
 *
 * `<pre>` y no un `<div>` con `white-space: pre`: el contenido es código y va a
 * ser leído y copiado como tal. `overflow-x-auto` en vez de wrap — una línea de
 * HTML partida en dos hace dudar de si el salto es parte del código.
 */
function BloqueCodigo({ codigo, etiqueta }: { codigo: string; etiqueta: string }): JSX.Element {
  const [copiado, setCopiado] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  async function copiar(): Promise<void> {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      if (temporizador.current) clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => setCopiado(false), 1500);
    } catch {
      // Sin permiso de clipboard (http sin TLS) el texto sigue visible y
      // seleccionable a mano. No hay fallback que valga un mensaje de error.
    }
  }

  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-ctrl border border-panel-borde bg-panel-sup2 px-3.5 py-3 pr-24 font-mono text-[12px] leading-relaxed text-tinta">
        <code>{codigo}</code>
      </pre>
      <button
        type="button"
        onClick={copiar}
        aria-label={copiado ? `${etiqueta} copiado` : `Copiar ${etiqueta}`}
        className={unir(
          'absolute right-2 top-2 inline-flex h-7 items-center gap-1.5 rounded-micro border px-2',
          'text-[12px] font-medium transition-[background-color,border-color,color] duration-150',
          copiado
            ? 'border-vivo-borde bg-vivo-suave text-vivo-oscuro'
            : 'border-panel-bordeFuerte bg-panel-sup text-tinta-2 hover:border-tinta-4 hover:text-tinta',
        )}
      >
        {copiado ? <Check size={12} weight="bold" /> : <Copy size={12} />}
        {copiado ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );
}

/** Numerito del paso. Un círculo con el número, no un emoji ni un bullet. */
function Paso({
  numero,
  titulo,
  children,
}: {
  numero: number;
  titulo: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex gap-3.5">
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-panel-bordeFuerte bg-panel-sup2 font-mono text-[12px] font-semibold text-tinta-2"
      >
        {numero}
      </span>
      <div className="min-w-0 flex-1 space-y-2.5">
        <p className="text-[13px] font-semibold text-tinta">{titulo}</p>
        {children}
      </div>
    </div>
  );
}

type Props = {
  integracion: Integracion;
  /** Los orígenes ya autorizados y activos, para no mandar a agregar uno que ya está. */
  origenesAutorizados: string[];
  /** En `/admin/origenes` alcanza con el paso del loader: los slugs se ven en el funnel. */
  soloLoader?: boolean;
};

export function ComoIntegrar({
  integracion,
  origenesAutorizados,
  soloLoader = false,
}: Props): JSX.Element {
  const [lenguaje, setLenguaje] = useState<'html' | 'jsx'>('jsx');

  const autorizados = new Set(origenesAutorizados);
  const faltantes = integracion.origenesNecesarios.filter((o) => !autorizados.has(o));
  const hayPasos = integracion.pasos.length > 0;
  const incompletos = integracion.pasos.filter((p) => p.incompleto);

  return (
    <Tarjeta className="p-5 sm:p-6">
      <div className="space-y-1.5">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-tinta">
          Cómo conectarlo a tu funnel
        </h2>
        <p className="max-w-[70ch] text-[13px] leading-relaxed text-tinta-2">
          El funnel vive en otro dominio y lo único que lo conecta con el cobro son el script y el{' '}
          <Codigo>slug</Codigo> de cada paso. Los slugs de abajo ya son los de este funnel: copiá y
          pegá, no los escribas a mano.
        </p>
      </div>

      {/* El selector de lenguaje vale para todos los bloques a la vez: quien
          integra un funnel lo hace en un solo stack, no en dos. */}
      {!soloLoader ? (
        <div className="mt-5 inline-flex rounded-ctrl border border-panel-bordeFuerte bg-panel-sup2 p-0.5">
          {(
            [
              ['jsx', 'React / Next'],
              ['html', 'HTML'],
            ] as const
          ).map(([valor, etiqueta]) => (
            <button
              key={valor}
              type="button"
              onClick={() => setLenguaje(valor)}
              aria-pressed={lenguaje === valor}
              className={unir(
                'rounded-[6px] px-2.5 py-1 text-[12px] font-medium transition-[background-color,color] duration-150',
                lenguaje === valor
                  ? 'bg-panel-sup text-tinta shadow-panel'
                  : 'text-tinta-3 hover:text-tinta',
              )}
            >
              {etiqueta}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-5 space-y-6">
        {/* ── 1. El loader ─────────────────────────────────────────────── */}
        <Paso numero={1} titulo="Pegá el script una sola vez en el funnel">
          <p className="text-[13px] leading-relaxed text-tinta-2">
            Va en todas las páginas del funnel, no solo en las de upsell: es el que lee el{' '}
            <Codigo>?ot=</Codigo> con el que llega el comprador y lo guarda para el resto de la
            sesión.
          </p>
          {integracion.baseConfigurada ? (
            <BloqueCodigo
              codigo={
                lenguaje === 'jsx' && !soloLoader ? integracion.loaderNext : integracion.loader
              }
              etiqueta="el script del loader"
            />
          ) : (
            /* Sin base absoluta el snippet saldría con `src="/loader.js"`, que
               pegado en el funnel apunta al dominio del funnel: 404 y los botones
               no cobran, sin ningún error que lo explique. Mejor no dar el
               snippet que dar uno roto que se ve bien. */
            <Aviso tono="peligro" icono={<Warning size={15} aria-hidden="true" />}>
              Falta configurar <Codigo>NEXT_PUBLIC_BASE_URL</Codigo> con la URL pública de este
              servicio. Sin eso el script saldría con una ruta relativa, que en el dominio del
              funnel apunta al funnel mismo y no carga nunca.
            </Aviso>
          )}
        </Paso>

        {/* ── 2. El dominio autorizado ─────────────────────────────────── */}
        <Paso numero={2} titulo="Autorizá el dominio del funnel">
          {integracion.origenesNecesarios.length === 0 ? (
            <p className="text-[13px] leading-relaxed text-tinta-2">
              Todavía no hay ninguna página de upsell configurada, así que no hay dominio que
              autorizar. Cargá la URL de la oferta en el paso y este recuadro te dice cuál agregar.
            </p>
          ) : (
            <>
              <p className="text-[13px] leading-relaxed text-tinta-2">
                Sin esto el botón recibe <Codigo>403</Codigo> y no cobra. Va el origen solo — sin
                path, que es lo que manda el navegador.
              </p>
              <ul className="space-y-1.5">
                {integracion.origenesNecesarios.map((origen) => (
                  <li key={origen} className="flex items-center gap-2">
                    <Codigo>{origen}</Codigo>
                    {autorizados.has(origen) ? (
                      <Insignia tono="vivo" icono={<Check size={11} weight="bold" />}>
                        autorizado
                      </Insignia>
                    ) : (
                      <Insignia tono="alerta" icono={<Warning size={11} />}>
                        falta agregarlo
                      </Insignia>
                    )}
                  </li>
                ))}
              </ul>
              {faltantes.length > 0 ? (
                <a
                  href="/admin/origenes"
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-acento hover:text-acento-oscuro"
                >
                  Ir a orígenes autorizados
                  <ArrowSquareOut size={13} aria-hidden="true" />
                </a>
              ) : null}
            </>
          )}
        </Paso>

        {/* ── 3. Los botones ──────────────────────────────────────────── */}
        {!soloLoader ? (
          <Paso numero={3} titulo="El botón de cada oferta">
            {!hayPasos ? (
              <p className="text-[13px] leading-relaxed text-tinta-2">
                Este funnel todavía no tiene pasos de upsell. Agregá uno arriba y acá aparece su
                botón, con el slug ya puesto.
              </p>
            ) : (
              <>
                <p className="text-[13px] leading-relaxed text-tinta-2">
                  El atributo <Codigo>data-hilvana-upsell</Codigo> es todo el contrato: el loader
                  engancha el click y cobra. El botón puede tener las clases y el contenido que
                  quieras.
                </p>
                <div className="space-y-4">
                  {integracion.pasos.map((paso) => (
                    <div key={paso.slug} className="space-y-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[13px] font-medium text-tinta">{paso.titulo}</span>
                        <span className="text-tinta-4" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-mono text-[12px] tabular-nums text-tinta-2">
                          {paso.precio}
                        </span>
                        <span className="text-tinta-4" aria-hidden="true">
                          ·
                        </span>
                        <Codigo>{paso.slug}</Codigo>
                        {paso.incompleto ? (
                          <Insignia tono="alerta" icono={<Warning size={11} />}>
                            sin URL de oferta
                          </Insignia>
                        ) : null}
                      </div>
                      {paso.urlExterna ? (
                        <p className="text-[12px] leading-relaxed text-tinta-3">
                          Va en <span className="font-mono">{paso.urlExterna}</span>
                        </p>
                      ) : null}
                      <BloqueCodigo
                        codigo={lenguaje === 'jsx' ? paso.jsx : paso.html}
                        etiqueta={`el botón de ${paso.titulo}`}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </Paso>
        ) : null}

        {/* ── 4. Cómo probarlo ────────────────────────────────────────── */}
        {!soloLoader && hayPasos ? (
          <Paso numero={4} titulo="Probarlo sin esperar el VSL">
            <p className="text-[13px] leading-relaxed text-tinta-2">
              Agregale <Codigo>offer=now</Codigo> a la URL de la oferta y el bloque se revela al
              instante. Ahora el botón aparece con él: es HTML de tu funnel, no lo inyecta un script
              con su propio reloj.
            </p>
            <ul className="space-y-1.5">
              {integracion.pasos
                .filter((p) => p.urlDePrueba)
                .map((paso) => (
                  <li key={paso.slug}>
                    <Codigo className="break-all">{paso.urlDePrueba}</Codigo>
                  </li>
                ))}
            </ul>
            <Aviso tono="acento" icono={<Info size={15} aria-hidden="true" />}>
              El click igual necesita el <Codigo>?ot=</Codigo> de una compra real: sale del checkout
              del front y no se puede inventar. Para recorrer la cadena entera, poné{' '}
              <Codigo>?offer=now</Codigo> en la URL de la oferta del paso: cuando el checkout
              redirija ahí le agrega <Codigo>&amp;ot=</Codigo> sin pisarlo, y llegás con la oferta ya
              revelada y el token puesto.
            </Aviso>
          </Paso>
        ) : null}
      </div>

      {incompletos.length > 0 ? (
        <Aviso tono="alerta" icono={<Warning size={15} aria-hidden="true" />} className="mt-5">
          {incompletos.length === 1 ? 'Un paso no tiene' : `${incompletos.length} pasos no tienen`}{' '}
          cargada la URL de su oferta. Sin eso el checkout no sabe a dónde mandar al comprador
          después de cobrar y se queda en la página de gracias.
        </Aviso>
      ) : null}
    </Tarjeta>
  );
}

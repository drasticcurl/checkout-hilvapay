'use client';

/**
 * El signing secret del webhook, cargable desde el panel — y la prueba de que
 * funciona.
 *
 * ── Por qué esta pantalla existe ─────────────────────────────────────────────
 * Hasta la migración 007 el secret salía SOLO de `WHOP_WEBHOOK_SECRET`, así que
 * cambiar de cuenta de Whop desde `/admin/conexion` dejaba la mitad del cambio
 * afuera: la API key nueva se guardaba, pero el webhook seguía verificando con el
 * secret de la cuenta anterior. Y **cada webhook de Whop tiene el suyo**.
 *
 * El modo de falla no tiene síntoma visible: los cobros entran igual —la plata se
 * mueve del lado de Whop— pero el endpoint rechaza cada entrega con 400, la orden
 * nunca se marca pagada y el comprador no recibe nada. Se ve como "nadie compró".
 *
 * Pasó el 2026-09-11: la cuenta que cobra no tenía ningún webhook registrado
 * porque el que existía era de la cuenta anterior.
 *
 * ── Por qué no hay botón de "probar" ─────────────────────────────────────────
 * Whop no expone ningún endpoint que valide un signing secret. No se puede probar
 * desde acá. Lo único que lo prueba es que Whop mande un evento real y que la
 * firma valide de este lado, y eso se dispara desde el dashboard de Whop con
 * **Send event**.
 *
 * Por eso la pantalla no promete una verificación que no puede hacer: muestra los
 * eventos que llegaron. Cero eventos después de un Send event ES el diagnóstico.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CheckCircle, Copy, Warning, WarningCircle } from '@phosphor-icons/react/ssr';
import type { EstadoWebhook } from '@/lib/admin/webhook-contrato';
import { EVENTOS_DEL_WEBHOOK } from '@/lib/admin/webhook-contrato';
import type { FuenteCredenciales } from '@/lib/whop-credenciales';
import { Aviso, Boton, Campo, Codigo, Tarjeta, clasesControl } from '@/components/panel/ui';

export type EstadoWebhookPanel = {
  hayWebhookSecret: boolean;
  webhookSecretFuente: FuenteCredenciales;
  webhookSecretAt: string | null;
  hayClaveDeCifrado: boolean;
  webhook: EstadoWebhook;
};

/** Copia al portapapeles y avisa. Sin librería: es una línea de la API del browser. */
function BotonCopiar({ texto, que }: { texto: string; que: string }): JSX.Element {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1600);
        } catch {
          /* sin portapapeles (http, permisos): el texto está a la vista para copiar a mano */
        }
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-ctrl border border-panel-borde px-2 py-1 text-[12px] text-tinta-2 hover:text-tinta"
      aria-label={`Copiar ${que}`}
    >
      <Copy size={13} aria-hidden="true" />
      {copiado ? 'copiado' : 'copiar'}
    </button>
  );
}

export function FormularioWebhook({ estado }: { estado: EstadoWebhookPanel }): JSX.Element {
  const router = useRouter();
  const [secret, setSecret] = useState('');
  const [password, setPassword] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const { webhook } = estado;
  const nuncaLlego = webhook.total === 0;

  async function guardar(): Promise<void> {
    setError(null);
    setOk(null);
    setGuardando(true);
    try {
      const res = await fetch('/api/admin/whop/webhook', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; motivo?: string };
      if (!res.ok || !data.ok) {
        setError(data.motivo ?? 'No se pudo guardar.');
        return;
      }
      setOk('Secret guardado. Ahora mandá un evento de prueba desde Whop.');
      setSecret('');
      setPassword('');
      router.refresh();
    } catch {
      setError('No se pudo contactar al servidor.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-4">
      <Tarjeta className="space-y-4 px-5 py-4">
        <div className="space-y-1">
          <h2 className="text-[15px] font-semibold text-tinta">Webhook</h2>
          <p className="text-[13px] leading-relaxed text-tinta-2">
            Es lo que le avisa a este servicio que un cobro entró. Sin esto la plata entra igual pero{' '}
            <strong className="font-medium text-tinta">nadie recibe lo que compró</strong>.
          </p>
        </div>

        {/* Paso 1: la URL. Se muestra derivada de la base y no hardcodeada, así
            que si el servicio cambia de dominio la pantalla sigue diciendo la
            verdad. */}
        <div className="space-y-1.5">
          <span className="block text-[13px] font-medium text-tinta">
            1. Pegá esta URL en Whop → Developer → Webhooks → Create
          </span>
          <div className="flex items-center gap-2">
            <Codigo className="min-w-0 flex-1 truncate">{webhook.url}</Codigo>
            <BotonCopiar texto={webhook.url} que="la URL del webhook" />
          </div>
          <p className="text-[12px] leading-relaxed text-tinta-2">
            Versión <strong className="font-medium text-tinta">v1</strong> — no v2 ni v5, esas no usan
            firmas Standard Webhooks y el endpoint las rechaza. Eventos hijos desactivados.
          </p>
        </div>

        {/* Paso 2: los eventos. Los seis que el handler procesa de verdad, no una
            lista genérica: tildar de más no rompe nada, pero tildar de menos deja
            un agujero silencioso. */}
        <div className="space-y-1.5">
          <span className="block text-[13px] font-medium text-tinta">2. Tildá estos seis eventos</span>
          <div className="flex flex-wrap gap-1.5">
            {EVENTOS_DEL_WEBHOOK.map((e) => (
              <Codigo key={e}>{e}</Codigo>
            ))}
          </div>
          <BotonCopiar texto={EVENTOS_DEL_WEBHOOK.join('\n')} que="la lista de eventos" />
        </div>

        {/* Paso 3: el secret. */}
        <Campo
          etiqueta="3. Pegá el signing secret que te dio Whop"
          htmlFor="webhook-secret"
          ayuda={
            <>
              Empieza con <span className="font-mono text-tinta-2">ws_</span>. Copialo completo y{' '}
              <strong className="font-medium text-tinta">sin recodificarlo en base64</strong>.
            </>
          }
        >
          <input
            id="webhook-secret"
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={estado.hayWebhookSecret ? 'hay uno cargado — pegá otro para reemplazarlo' : 'ws_...'}
            className={clasesControl('font-mono')}
          />
        </Campo>

        <Campo
          etiqueta="Contraseña del panel"
          htmlFor="webhook-password"
          ayuda="Se pide de nuevo porque con este secret se puede falsificar una venta."
        >
          <input
            id="webhook-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={clasesControl()}
          />
        </Campo>

        {error ? (
          <Aviso tono="peligro" rol="alert" icono={<WarningCircle size={16} aria-hidden="true" />}>
            {error}
          </Aviso>
        ) : null}
        {ok ? (
          <Aviso tono="vivo" icono={<CheckCircle size={16} aria-hidden="true" />}>
            {ok}
          </Aviso>
        ) : null}

        {!estado.hayClaveDeCifrado ? (
          <Aviso tono="alerta" icono={<Warning size={16} aria-hidden="true" />} titulo="Falta la clave de cifrado">
            Sin <span className="font-mono">CONFIG_ENCRYPTION_KEY</span> el secret no se puede guardar
            cifrado. Generá una con <span className="font-mono">openssl rand -hex 32</span>, ponela en el
            .env y reiniciá.
          </Aviso>
        ) : null}

        <div className="flex items-center gap-2">
          <Boton onClick={guardar} disabled={guardando || !secret || !password}>
            {guardando ? 'Guardando…' : 'Guardar secret'}
          </Boton>
          {estado.hayWebhookSecret ? (
            <span className="text-[12px] text-tinta-2">
              hay uno cargado, de{' '}
              {estado.webhookSecretFuente === 'base' ? 'este panel' : 'las variables de entorno'}
              {estado.webhookSecretAt
                ? ` (${new Date(estado.webhookSecretAt).toLocaleString('es-AR')})`
                : ''}
            </span>
          ) : (
            <span className="text-[12px] font-medium text-peligro">no hay ninguno cargado</span>
          )}
        </div>
      </Tarjeta>

      {/* ── La prueba ────────────────────────────────────────────────────────
          Lo único que verifica un signing secret es un evento real. Esta tarjeta
          no dice "está bien configurado": dice qué llegó y cuándo. */}
      <Tarjeta className="space-y-3 px-5 py-4">
        <div className="space-y-1">
          <h2 className="text-[15px] font-semibold text-tinta">4. Probalo desde Whop</h2>
          <p className="text-[13px] leading-relaxed text-tinta-2">
            En el dashboard de Whop, en el webhook que creaste: <strong className="font-medium text-tinta">Send
            event</strong> → <span className="font-mono">payment.succeeded</span>. Tiene que responder{' '}
            <span className="font-mono">200</span>. Después recargá esta pantalla.
          </p>
        </div>

        {nuncaLlego ? (
          <Aviso tono="peligro" rol="status" icono={<WarningCircle size={16} aria-hidden="true" />} titulo="Todavía no llegó ningún evento">
            Si ya mandaste el evento de prueba y sigue en cero, el secret no coincide o la URL apunta a
            otro lado. Whop devuelve <span className="font-mono">400 firma inválida</span> y no queda nada
            guardado de este lado.
          </Aviso>
        ) : (
          <Aviso tono="vivo" rol="status" icono={<CheckCircle size={16} aria-hidden="true" />} titulo="El webhook funciona">
            Llegaron {webhook.total} eventos firmados
            {webhook.ultimas24h > 0 ? `, ${webhook.ultimas24h} en las últimas 24 horas` : ''}.
          </Aviso>
        )}

        {webhook.ultimo ? (
          <dl className="divide-y divide-panel-borde text-[13px]">
            <div className="flex items-baseline justify-between gap-2 py-2">
              <dt className="text-tinta-2">Último evento</dt>
              <dd>
                <Codigo>{webhook.ultimo.tipo}</Codigo>
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 py-2">
              <dt className="text-tinta-2">Recibido</dt>
              <dd className="font-mono text-[12px] tabular-nums text-tinta-2">
                {new Date(webhook.ultimo.recibidoAt).toLocaleString('es-AR')}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 py-2">
              <dt className="text-tinta-2">Procesado</dt>
              <dd className="text-right">
                {webhook.ultimo.procesadoAt ? (
                  <span className="font-mono text-[12px] tabular-nums text-tinta-2">
                    {new Date(webhook.ultimo.procesadoAt).toLocaleString('es-AR')}
                  </span>
                ) : (
                  <span className="text-[12px] font-medium text-peligro">no se procesó</span>
                )}
              </dd>
            </div>
            {webhook.ultimo.error ? (
              <div className="py-2">
                <dt className="text-tinta-2">Error</dt>
                <dd className="mt-1 break-words font-mono text-[12px] text-peligro">
                  {webhook.ultimo.error}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {/* Un evento recibido y no procesado es un bug de este lado, no de Whop, y
            se arregla distinto: el `Send event` de nuevo lo reintenta porque el
            handler reprocesa lo que quedó con `procesado_at` en NULL. */}
        {webhook.sinProcesar > 0 ? (
          <Aviso tono="alerta" icono={<Warning size={16} aria-hidden="true" />} titulo={`${webhook.sinProcesar} sin procesar`}>
            Llegaron y la firma validó, pero fallaron después. Eso es un problema de este lado, no del
            secret. Volver a mandarlos con <strong className="font-medium text-tinta">Send event</strong>{' '}
            los reintenta.
          </Aviso>
        ) : null}
      </Tarjeta>
    </div>
  );
}

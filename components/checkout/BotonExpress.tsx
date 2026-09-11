'use client';

import { useState } from 'react';
import { WhopExpressCheckoutButton } from '@whop/checkout/react';
import type { WhopCheckoutPaymentError } from '@whop/checkout/util';

/**
 * El componente de Whop, con las props que este archivo usa y nada más.
 *
 * El cast existe porque el tipo de retorno que declara `@whop/checkout` 0.6.0
 * incluye `Promise<ReactNode>` y `bigint`, y `@types/react` 18 no los acepta como
 * elemento JSX: `tsc` corta con TS2786 aunque en runtime el componente devuelva un
 * elemento normal. Es un problema de la declaración de tipos de la librería, no
 * del uso.
 *
 * Se castea a una firma EXPLÍCITA en vez de a `any` o de poner un
 * `@ts-expect-error` sobre el JSX: así las props que se pasan abajo siguen
 * chequeadas contra esta lista. Si mañana se agrega una prop mal escrita, `tsc`
 * la marca. Un `any` la dejaría pasar en silencio, que en un formulario de pago es
 * exactamente lo que no se quiere.
 *
 * `CajaTarjeta` tiene el mismo problema con `WhopCheckoutEmbed` y lo resuelve con
 * dos `as never` puntuales; acá el cast es del componente entero porque la
 * incompatibilidad está en su tipo de retorno, no en una prop.
 */
const BotonWallet = WhopExpressCheckoutButton as unknown as (props: {
  checkoutConfigurationId: string;
  returnUrl: string;
  setupFutureUsage?: 'off_session';
  prefill?: { email?: string };
  environment?: 'production' | 'sandbox';
  locale?: string;
  theme?: 'light' | 'dark' | 'system';
  themeOptions?: { accentColor?: string; highContrast?: boolean };
  onComplete?: (planId: string, receiptOrSetupIntentId?: string) => void;
  onPaymentError?: (error: WhopCheckoutPaymentError) => void;
  onExpressMethodResolved?: (info: { rendered: string }) => void;
}) => JSX.Element;

/**
 * Apple Pay / Google Pay / Whop Pay en un toque, para la pantalla de
 * recuperación.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * Cuando el cobro one-click falla, el comprador termina acá y tiene que volver a
 * tipear los 16 dígitos de la tarjeta que ya usó hace treinta segundos. Es la
 * fricción máxima en el peor momento: ya dijo que sí, y le pedimos trabajo.
 *
 * Con el wallet no tipea nada — aprueba con Face ID o con el PIN del teléfono — y
 * el wallet **resuelve la autenticación del banco por su cuenta**. Eso importa
 * especialmente acá: el motivo por el que el one-click falla en esta cuenta es
 * que Whop no puede completar un desafío 3DS sin nadie del otro lado (medido el
 * 2026-09-11: `POST /payments` off-session devuelve 400 `bad_request` sin
 * `decline_code`, con los cuatro ids válidos y el pago del front autenticado con
 * `three_ds_verified: true`). En el wallet ese desafío lo resuelve el dispositivo.
 *
 * No reemplaza al one-click ni pretende arreglarlo: es la mejor salida cuando ya
 * falló.
 *
 * ── Qué se renderiza y qué NO ───────────────────────────────────────────────
 * Un solo botón, el que el navegador soporte, en este orden: Apple Pay en Safari,
 * Google Pay en Chrome/Android, Whop Pay (un diálogo) en el resto.
 *
 * Apple Pay además exige el dominio verificado en Whop; el archivo
 * `public/.well-known/apple-developer-merchantid-domain-association` ya se sirve
 * (200 en producción), pero falta registrarlo en el dashboard. **Google Pay no
 * necesita esa verificación**, así que este componente ya aporta hoy en Chrome y
 * Android, que es la mayoría del tráfico del funnel.
 *
 * Si el navegador no puede mostrar ninguno, `onExpressMethodResolved` avisa con
 * `rendered: 'none'` y este componente se esconde entero. Sin eso queda un hueco
 * con un separador "o con tarjeta" que no separa nada, y el comprador se pregunta
 * qué falló.
 */
export function BotonExpress({
  sessionId,
  email,
  environment,
  onCompletado,
  onError,
}: {
  /** El `checkout_configuration` que ya creó el server, con su metadata. */
  sessionId: string;
  email: string;
  environment: 'production' | 'sandbox';
  onCompletado: (receiptId: string) => void;
  onError: (mensaje: string) => void;
}): JSX.Element | null {
  // Arranca en `true` y solo se apaga si Whop dice que no hay método: si
  // arrancara oculto, el botón aparecería de golpe un instante después y correría
  // el resto de la pantalla hacia abajo justo cuando el comprador va a tocar.
  const [puedeRenderizar, setPuedeRenderizar] = useState(true);

  if (!puedeRenderizar) return null;

  return (
    <div className="flex flex-col gap-3">
      <BotonWallet
        // `checkoutConfigurationId` y no `planId`: la sesión ya la creó el server
        // con la metadata de la orden y el paso (`orden_id`, `pagina_id`), que es
        // lo que después vincula el pago con el cobro. Con `planId` se crearía una
        // sesión nueva sin esa metadata y el pago quedaría huérfano.
        checkoutConfigurationId={sessionId}
        // Requerido por el componente: un pago iniciado acá puede completarse
        // dentro del overlay de Whop con un método que redirige (3DS, por
        // ejemplo), y el comprador necesita a dónde volver. `onComplete` implica
        // `skipRedirect: true`, así que en el camino feliz esta URL no se usa —
        // pero tiene que existir para el que sí redirige.
        returnUrl={typeof window !== 'undefined' ? window.location.href : ''}
        // Se vuelve a pedir guardar la tarjeta. Hoy el cobro off-session está
        // bloqueado del lado de Whop, pero el día que se desbloquee, el comprador
        // que pasó por acá ya queda habilitado para el one-click del paso
        // siguiente sin tener que hacer nada.
        setupFutureUsage="off_session"
        prefill={{ email }}
        environment={environment}
        locale="es"
        // Claro forzado por el mismo motivo que `CajaTarjeta`: el default de Whop
        // sigue el modo del sistema, y a quien tenga el celular en oscuro le
        // saldría un botón negro en el medio de una página blanca.
        theme="light"
        themeOptions={{ accentColor: 'blue' }}
        onComplete={(_planId: string, receiptId?: string) => {
          if (receiptId) onCompletado(receiptId);
        }}
        onPaymentError={(error: WhopCheckoutPaymentError) =>
          onError(`${error.message}${error.code ? ` (${error.code})` : ''}`)
        }
        onExpressMethodResolved={({ rendered }) => {
          if (rendered === 'none') setPuedeRenderizar(false);
        }}
      />

      {/* El separador vive DENTRO de este componente y no en el contenedor a
          propósito: así desaparece junto con el botón cuando no hay wallet, en vez
          de quedar anunciando una alternativa que no está. */}
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-borde" />
        <span className="text-[12px] text-texto-2">o con tarjeta</span>
        <span className="h-px flex-1 bg-borde" />
      </div>
    </div>
  );
}

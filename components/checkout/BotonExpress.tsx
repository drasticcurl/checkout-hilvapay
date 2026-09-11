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

/** Lo que el componente le reporta al contenedor sobre qué pasó. */
export type EventoWallet =
  | { tipo: 'metodo'; rendered: string }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'completado'; receiptId: string | null };

/**
 * Apple Pay / Google Pay / Whop Pay en un toque, para la pantalla de
 * recuperación.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * Cuando el cobro one-click falla, el comprador termina acá y tiene que volver a
 * tipear los 16 dígitos de la tarjeta que ya usó hace treinta segundos. Con el
 * wallet no tipea nada — aprueba con Face ID — y **el wallet resuelve la
 * autenticación del banco por su cuenta**, que es justo lo que el cobro
 * off-session no puede hacer.
 *
 * ── UNA SOLA SURFACE DE WHOP POR VEZ ────────────────────────────────────────
 * Este componente y `CajaTarjeta` NO se montan juntos, y esa es la corrección
 * más importante de esta versión.
 *
 * La primera versión los mostraba a la vez, los dos sobre la MISMA
 * `checkout_configuration`. Probado con Apple Pay real el 2026-09-11: la hoja se
 * abría, el comprador la completaba, volvía a la página, y **no se creaba ningún
 * pago en Whop** — verificado en `GET /payments`, donde el último pago seguía
 * siendo el del front. Dos embeds de Whop peleándose la misma sesión.
 *
 * Ahora el contenedor muestra el wallet primero y el formulario solo si el
 * comprador lo pide. Nunca hay dos.
 *
 * ── El returnUrl ────────────────────────────────────────────────────────────
 * Llega por prop desde el server, ya absoluto. La primera versión lo armaba con
 * `typeof window !== 'undefined' ? window.location.href : ''`, así que en el
 * primer render era **una cadena vacía** — y la doc de Whop exige una URL
 * absoluta. El componente montaba con un valor inválido y solo se corregía en el
 * render siguiente, si llegaba a corregirse.
 */
export function BotonExpress({
  sessionId,
  returnUrl,
  email,
  environment,
  onCompletado,
  onError,
  onEvento,
}: {
  /** El `checkout_configuration` de este wallet. NO se comparte con CajaTarjeta. */
  sessionId: string;
  /** URL absoluta a la que vuelve el comprador si el método redirige. Del server. */
  returnUrl: string;
  email: string;
  environment: 'production' | 'sandbox';
  onCompletado: (receiptId: string) => void;
  onError: (mensaje: string) => void;
  /** Telemetría para el contenedor: qué método se renderizó, qué falló. */
  onEvento?: (e: EventoWallet) => void;
}): JSX.Element | null {
  // Arranca en `true` y solo se apaga si Whop dice que no hay método: si
  // arrancara oculto, el botón aparecería de golpe un instante después y correría
  // el resto de la pantalla hacia abajo justo cuando el comprador va a tocar.
  const [puedeRenderizar, setPuedeRenderizar] = useState(true);

  if (!puedeRenderizar) return null;

  return (
    <BotonWallet
      // La sesión es propia de este componente (ver el bloque de arriba sobre por
      // qué no se comparte con CajaTarjeta). Sigue llevando la metadata de la
      // orden, que es lo que `/api/checkout/reclamar` usa para validar que el pago
      // sea de esta orden y no de otra.
      checkoutConfigurationId={sessionId}
      returnUrl={returnUrl}
      // Se vuelve a pedir guardar la tarjeta. Hoy el cobro off-session está
      // bloqueado del lado de Whop, pero el día que se desbloquee, el comprador
      // que pasó por acá ya queda habilitado para el one-click del paso siguiente.
      setupFutureUsage="off_session"
      prefill={{ email }}
      environment={environment}
      locale="es"
      // Claro forzado por el mismo motivo que `CajaTarjeta`: el default de Whop
      // sigue el modo del sistema, y a quien tenga el celular en oscuro le saldría
      // un botón negro en el medio de una página blanca.
      theme="light"
      themeOptions={{ accentColor: 'blue' }}
      onComplete={(_planId: string, receiptId?: string) => {
        // Se reporta SIEMPRE, con o sin receiptId. Un `onComplete` sin receipt es
        // exactamente el síntoma que hubo que diagnosticar a ciegas la primera
        // vez, y sin este aviso no queda registro de que ocurrió.
        onEvento?.({ tipo: 'completado', receiptId: receiptId ?? null });
        if (receiptId) onCompletado(receiptId);
        else onError('El pago se completó pero Whop no devolvió el comprobante. Escribinos para confirmarlo.');
      }}
      onPaymentError={(error: WhopCheckoutPaymentError) => {
        const msg = `${error.message}${error.code ? ` (${error.code})` : ''}`;
        onEvento?.({ tipo: 'error', mensaje: msg });
        onError(msg);
      }}
      onExpressMethodResolved={({ rendered }) => {
        onEvento?.({ tipo: 'metodo', rendered });
        if (rendered === 'none') setPuedeRenderizar(false);
      }}
    />
  );
}

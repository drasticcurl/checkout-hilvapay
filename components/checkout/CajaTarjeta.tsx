'use client';

import { forwardRef } from 'react';
import { WhopCheckoutEmbed } from '@whop/checkout/react';
import type { WhopCheckoutPaymentError, WhopCheckoutState } from '@whop/checkout/util';

/** Lo mínimo que el contenedor necesita del embed: dispararle el submit. */
export type ControlesTarjeta = { submit: () => Promise<void> };

/**
 * La caja con borde y título propio que envuelve el iframe de Whop. La caja y
 * el título son HTML nuestro; los campos de tarjeta de adentro son el embed,
 * sin tocar — es la misma limitación que tiene KashPay hoy (Whop Elements,
 * que sí permite CSS propio en los campos, está en beta y no se usa acá).
 *
 * `sessionId` viene de `crearCheckoutConfiguration` (mode: 'payment'), así que
 * en runtime `onComplete` llega con la firma de pago:
 * `(plan_id, receipt_id, result)`, no la de setup (`session_id,
 * setup_intent_id, result)`. El tipo de la librería es una unión porque el
 * mismo componente sirve para las dos configuraciones; como acá SIEMPRE es
 * `mode: 'payment'`, se castea explícitamente en vez de manejar el caso que
 * nunca ocurre.
 */
export const CajaTarjeta = forwardRef<ControlesTarjeta, {
  sessionId: string;
  planId: string;
  email: string;
  environment: 'production' | 'sandbox';
  onReady: (listo: boolean) => void;
  onCompletado: (receiptId: string) => void;
  onError: (mensaje: string) => void;
}>(function CajaTarjeta({ sessionId, planId, email, environment, onReady, onCompletado, onError }, ref) {
  return (
    // Sin título propio arriba del iframe: el embed de Whop dibuja el suyo
    // ("Tarjeta de crédito" con el radio y el icono), y dos títulos seguidos se
    // leen como un error de la página. La caja con borde azul y el padding son
    // de este lado, que es lo único que se puede estilar del embed desde afuera.
    <div className="whop-checkout-wrapper rounded-lg border border-precio px-3 py-2">
      <WhopCheckoutEmbed
        ref={ref as never}
        sessionId={sessionId}
        planId={planId}
        // Sin esto Whop no guarda el método de pago y no hay upsell
        // one-click: es la prop de la que depende el módulo entero.
        setupFutureUsage="off_session"
        // Botón propio abajo dispara el submit del iframe; el de Whop no se
        // muestra. Requiere @whop/checkout >= 0.0.43 (0.6.0 acá, verificado).
        hideSubmitButton
        hideEmail
        hidePrice
        // El consentimiento para guardar la tarjeta y cobrar después vive en
        // este texto. Ocultarlo deja un one-click sin mandato del titular, que
        // es un contracargo indefendible: no se apaga nunca desde este task.
        hideTermsAndConditions={false}
        locale="es"
        environment={environment}
        skipRedirect
        prefill={{ email }}
        // ── Por qué se fuerza el claro y no se deja el default ───────────────
        // El default de Whop es `theme: 'system'`: sigue el modo del sistema del
        // visitante. Con la página de checkout en blanco, a cualquiera que tenga
        // el celular en modo oscuro le salía el iframe NEGRO en el medio de una
        // página blanca. Y no es un detalle estético: un formulario de tarjeta
        // que se ve pegado con cinta es exactamente lo que hace abandonar una
        // compra.
        //
        // `backgroundColor` es el que manda de verdad — la doc dice que el embed
        // elige el color del texto según ese valor y que **anula `theme`**. Se
        // pasan los dos igual: si algún día cambia esa precedencia, el `theme`
        // explícito deja el embed en claro en vez de volver a seguir al sistema.
        theme="light"
        themeOptions={{ backgroundColor: '#ffffff', accentColor: 'blue', borderRadius: 8 }}
        styles={{ container: { paddingX: 0, paddingY: 0 } }}
        onStateChange={(state: WhopCheckoutState) => onReady(state === 'ready')}
        onPaymentError={(error: WhopCheckoutPaymentError) => onError(`${error.message}${error.code ? ` (${error.code})` : ''}`)}
        onComplete={((_planId: string, receiptId: string | undefined) => {
          if (receiptId) onCompletado(receiptId);
        }) as never}
        fallback={
          <div className="flex h-32 items-center justify-center">
            <span
              className="h-6 w-6 animate-spin rounded-full border-2 border-borde border-t-precio"
              role="status"
              aria-label="Cargando el formulario de pago"
            />
          </div>
        }
      />
    </div>
  );
});


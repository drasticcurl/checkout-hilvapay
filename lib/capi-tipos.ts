/**
 * Contrato A (00-PLAN-PANEL-Y-CAPI.md §4) — el payload que checkout-kashhhpay
 * manda a POST /api/webhooks/checkout-propio de dashboard-admin.
 *
 * ESPEJO: dashboard-admin/lib/orders/checkout-propio-tipos.ts declara el
 * mismo tipo con el mismo nombre. Si cambiás este archivo, cambiá el otro.
 * No hay paquete compartido entre los dos repos — son proyectos Next.js
 * independientes — así que la sincronización es manual y a propósito.
 */
export type PayloadVentaCheckoutPropio = {
  cobroId: string;
  whopPlanId: string;
  email: string | null;
  monto: string;
  moneda: string;
  purchasedAt: string;
  utms: {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    utm_term?: string;
  };
  fbclid?: string;
  sessionId?: string;
  visitorId?: string;
};

export type RespuestaVentaCheckoutPropio =
  | { ok: true; orderId: number; isNew: boolean; funnelId: number | null }
  | { ok: true; orderId: null; isNew: false }
  | { ok: false; error: string };

/** Contrato B (00-PLAN-PANEL-Y-CAPI.md §5) — el evento que lib/capi.ts (T04) manda a Meta. */
export type CapiTarget = { pixelId: string; accessToken: string };

export type EventoCapiPurchase = {
  event_name: 'Purchase';
  event_time: number;
  event_id: string;
  action_source: 'website';
  event_source_url: string;
  user_data: {
    em?: string[];
    fbc?: string;
  };
  custom_data: {
    value: number;
    currency: string;
  };
};

export type ResultadoArmadoCapi =
  | { ok: true; evento: EventoCapiPurchase }
  | { ok: false; motivo: string };

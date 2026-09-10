/**
 * Los tipos que cruzan fronteras entre tasks. **Contrato congelado** (§4 del
 * plan): T02, T03, T04 y T05 se escriben contra estas formas al mismo tiempo, así
 * que cambiar algo acá rompe las cuatro.
 *
 * Lo que NO va en este archivo: los tipos que usa una sola task. Esos viven en
 * su módulo. Acá solo lo compartido.
 *
 * ── Cómo leer los tipos de fila ─────────────────────────────────────────────
 * Son lo que devuelve el driver `pg`, no lo que dice el DDL:
 *
 *   numeric(10,2)  →  string    ('9.90', NO 9.9)
 *   timestamptz    →  Date
 *   jsonb          →  objeto ya parseado
 *   uuid, text     →  string
 *   int, bigint    →  number    (bigint también, mientras entre en un Number)
 *
 * El `numeric` como string es la trampa: si lo tratás como number, `9.90` se
 * muestra como `9.9` y el precio del checkout deja de coincidir con el de la
 * landing. Formatealo explícitamente.
 */

// EstadoCobro se RE-EXPORTA, no se redeclara: está atado al CHECK de la tabla
// `cobros`, y dos definiciones se desincronizan en el primer estado nuevo.
export type { EstadoCobro, AccionDecline } from './estado-pago';

// ── Filas ────────────────────────────────────────────────────────────────────

/** Fila de `productos`. Lo que se vende, con el nombre y el precio REALES. */
export type Producto = {
  id: string;
  /** El nombre que ve el comprador. En Whop el plan puede llamarse distinto. */
  nombre: string;
  whop_plan_id: string;
  whop_product_id: string | null;
  /** Cómo se llama el plan del lado de Whop. Cacheado para mostrar los dos juntos. */
  whop_nombre_soft: string | null;
  /** Precio que se MUESTRA. Debe coincidir con el `initial_price` del plan (D10). */
  precio: string;
  moneda: string;
  /** Precio tachado. Solo display. */
  precio_anclaje: string | null;
  imagen_url: string | null;
  descripcion: string | null;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
};

/**
 * El jsonb de `paginas.config`.
 *
 * **TODOS los campos son opcionales y la UI tiene que funcionar sin ninguno.**
 * Una página que el panel creó antes de que existiera un campo nuevo no puede
 * romper el checkout: sin esta regla, agregar una opción al panel rompe todos los
 * links viejos.
 */
export type ConfigPagina = {
  /** Minutos del contador de "la oferta expira en". Ausente = sin timer. */
  timerMinutos?: number;
  /** Texto del botón verde. Default: 'COMPRAR AHORA'. */
  textoBoton?: string;
  /** Muestra la barra "100% SEGURO". Default: true. */
  badgeSeguro?: boolean;
  /** Bajada arriba de la card del producto. */
  subtitulo?: string;
};

/** Fila de `paginas`. Cada una es un link de pago, `/pagos/<slug>`. */
export type Pagina = {
  id: string;
  slug: string;
  producto_id: string;
  tipo: 'front' | 'upsell';
  url_exito: string | null;
  url_rechazo: string | null;
  config: ConfigPagina;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
};

/** Una página con su producto ya resuelto. Es lo que la página de checkout necesita. */
export type PaginaConProducto = Omit<Pagina, 'producto_id'> & { producto: Producto };

/** Fila de `origenes`. La allowlist de CORS del cobro one-click. */
export type Origen = {
  id: string;
  /** 'https://funnel.com', sin barra final. */
  origen: string;
  nombre: string | null;
  activo: boolean;
  created_at: Date;
};

/** Fila de `ordenes`. Un comprador que arrancó un checkout. */
export type Orden = {
  id: string;
  pagina_id: string;
  email: string | null;
  nombre: string | null;
  /** Token público que viaja en la URL hacia los upsells. Habilita cobrar. */
  token: string;
  token_expira_at: Date;
  whop_member_id: string | null;
  /**
   * El método guardado. Viene con prefijo `payt_` del objeto Payment, aunque el
   * ejemplo del request de POST /payments lo muestre como `pmt_`. Se usa tal
   * cual: validar el prefijo rompe en cuanto Whop unifique la doc.
   */
  whop_payment_method_id: string | null;
  whop_user_id: string | null;
  whop_checkout_config_id: string | null;
  /** false = pagó con un método no guardable. Esa persona no tiene one-click. */
  metodo_guardado: boolean;
  /** Atribución que llega del funnel. `null` si no vino o no era un UUID. */
  session_id: string | null;
  visitor_id: string | null;
  utms: Record<string, string> | null;
  created_at: Date;
  updated_at: Date;
};

/** Fila de `cobros`. Un intento de cobro. */
export type Cobro = {
  id: string;
  orden_id: string;
  pagina_id: string;
  producto_id: string;
  whop_plan_id: string;
  whop_payment_id: string | null;
  status: import('./estado-pago').EstadoCobro;
  decline_code: string | null;
  failure_message: string | null;
  idempotency_key: string;
  monto: string | null;
  moneda: string | null;
  origen: 'front' | 'upsell';
  /**
   * Un cobro reembolsado sigue en `status: 'pagado'`: la plata entró y después
   * salió, y son dos hechos distintos. Mezclarlos haría que un reembolso se vea
   * igual que un cobro que nunca salió.
   */
  reembolsado_at: Date | null;
  disputa_at: Date | null;
  email_enviado_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/** Fila de `salidas`. La cola hacia el dashboard-admin y el email. */
export type Salida = {
  id: string;
  cobro_id: string | null;
  destino: string;
  payload: Record<string, unknown>;
  intentos: number;
  ultimo_error: string | null;
  enviado_at: Date | null;
  proximo_intento_at: Date;
  created_at: Date;
};

// ── Respuestas de la API ─────────────────────────────────────────────────────

/** Respuesta de `POST /api/checkout/sesion`. */
export type RespuestaSesion = {
  ordenId: string;
  /** El `ch_...` que se le pasa al embed como `sessionId`. */
  sessionId: string;
  /** El token de la orden, que viaja a las páginas de upsell como `?ot=`. */
  token: string;
};

/**
 * Respuesta de `POST /api/upsell/cobrar` y de `GET /api/cobros/[id]`.
 *
 * **Es el contrato que consume el `loader.js`, que corre en el dominio de los
 * funnels.** Agregarle un campo es seguro; sacarle uno o renombrarlo rompe
 * funnels ya publicados, que no se redeployan solos.
 */
export type RespuestaCobro = {
  cobroId: string;
  estado: import('./estado-pago').EstadoCobro;
  /** A dónde mandar a la persona. `null` = quedate donde estás y mostrá `mensaje`. */
  siguienteUrl: string | null;
  /** Mensaje ya listo para mostrar. NUNCA trae el `decline_code` crudo. */
  mensaje: string | null;
  /** true = montá el embed para que ponga la tarjeta (es un pago nuevo, D3). */
  pedirTarjeta: boolean;
  /** El `sessionId` para ese embed. Solo viene cuando `pedirTarjeta` es true. */
  sessionIdRecuperacion: string | null;
};

/** Los errores que devuelven los endpoints públicos, como unión cerrada. */
export type ErrorPublico =
  | 'payload_invalido'
  | 'token_invalido'
  | 'token_vencido'
  | 'origen_no_autorizado'
  | 'pagina_inexistente'
  | 'pagina_inactiva'
  | 'sin_metodo_guardado';

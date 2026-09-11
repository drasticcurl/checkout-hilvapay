/**
 * Lógica pura del tutorial de primera implementación (`/admin/tutorial`).
 *
 * Un tutorial que no sabe dónde estás es una página de texto muerta: por eso
 * cada paso se marca "hecho" leyendo el estado REAL de la base y de la config,
 * no una checklist que alguien tilda a mano. Este módulo no hace IO — recibe un
 * `SnapshotTutorial` ya armado (las queries viven en `tutorialSnapshot()`, más
 * abajo en este mismo archivo pero separadas, y en las páginas del panel que ya
 * existían) y devuelve los pasos con su estado. Separarlo así es lo que permite
 * testear "cuál es el siguiente paso" sin levantar Postgres.
 *
 * El orden de los pasos ES el orden en que hay que hacerlos: `pasosTutorial`
 * devuelve un array y el primero no completo es "seguí por acá". No hay pasos
 * opcionales que puedan hacerse en cualquier momento — encender el freno de
 * emergencia (paso 8) sin haber cargado productos (paso 4) no tiene sentido, y
 * el orden lineal es justamente lo que evita ese estado confuso.
 */

/** Todo lo que un paso necesita saber para decidir si está hecho. Sin IO. */
export type SnapshotTutorial = {
  /** Hay una API key de Whop verificada (en la base o, como piso, en el entorno). */
  credencialesVerificadas: boolean;
  /** Al menos un evento de Whop llegó alguna vez a `POST /api/webhooks/whop`. */
  webhookRecibioAlgunEvento: boolean;
  /** Productos cargados en `/admin/productos` con un `whop_plan_id` no vacío. */
  productosConPlan: number;
  /** Hay al menos un funnel con un paso `front` Y un paso `upsell`. */
  hayFunnelConFrontYUpsell: boolean;
  /** Dominios en `/admin/origenes` con el switch activo. */
  origenesActivos: number;
  /** Funnels con `activo = true` (para el paso de "encender"). */
  funnelsActivos: number;
  /** Cobros con `status = 'pagado'` alguna vez (para el paso de "probar"). */
  cobrosPagados: number;
};

export type EstadoPaso = 'hecho' | 'siguiente' | 'pendiente';

export type PasoTutorial = {
  numero: number;
  titulo: string;
  descripcion: string;
  /** A dónde ir a hacerlo. */
  href: string;
  /** Texto del link, cuando conviene que diga algo distinto de "Ir a...". */
  textoLink: string;
  hecho: boolean;
  /** Por qué se lo considera hecho (o no), para mostrar en la UI. */
  detalle: string;
};

export type PasoConEstado = PasoTutorial & { estado: EstadoPaso };

/**
 * Define los 9 pasos del flujo (README, sección "Levantarlo" en adelante) y
 * si cada uno está hecho, a partir del snapshot. El contenido de cada paso —
 * qué hacer y por qué — está fijado por el flujo real verificado; no se inventa
 * texto que no esté respaldado por lo que el snapshot puede confirmar.
 */
export function pasosTutorial(s: SnapshotTutorial): PasoTutorial[] {
  return [
    {
      numero: 1,
      titulo: 'Conectar Whop',
      descripcion:
        'Pegá una Account API key (Dashboard de Whop → Developer → Account API keys). El botón "Identificar" saca el company id solo, y la credencial se verifica contra Whop antes de guardarse.',
      href: '/admin/conexion',
      textoLink: 'Ir a Conexión',
      hecho: s.credencialesVerificadas,
      detalle: s.credencialesVerificadas
        ? 'Hay credenciales verificadas contra Whop.'
        : 'Todavía no hay una API key verificada.',
    },
    {
      numero: 2,
      titulo: 'Registrar el webhook en Whop',
      descripcion:
        'Dashboard de Whop → Developer → Webhooks → Create. URL https://pay.hilvanapp.com/api/webhooks/whop, versión v1 (no v2 ni v5), eventos payment.created, payment.succeeded, payment.failed, payment.pending, refund.created, dispute.created. El signing secret (empieza con ws_) va en WHOP_WEBHOOK_SECRET.',
      href: '/admin/conexion',
      textoLink: 'Ver conexión',
      hecho: s.webhookRecibioAlgunEvento,
      detalle: s.webhookRecibioAlgunEvento
        ? 'Ya llegó al menos un evento de Whop.'
        : 'Todavía no llegó ningún evento. Puede ser que falte crear el webhook, o que falte la primera venta que lo dispare.',
    },
    {
      numero: 3,
      titulo: 'Crear los planes en Whop',
      descripcion:
        'Uno por precio, tipo one_time, SIEMPRE atado a un producto. Un plan huérfano (sin producto) no admite códigos de descuento.',
      href: '/admin/catalogo',
      textoLink: 'Ver catálogo',
      // No hay una señal propia en la base para "existen planes en Whop": ese
      // dato vive en Whop, no acá. Se marca hecho junto con el paso 4 (cargar
      // productos), porque cargar un producto exige haber creado el plan antes
      // — no se puede completar el 4 sin haber completado el 3.
      hecho: s.productosConPlan > 0,
      detalle:
        s.productosConPlan > 0
          ? 'Ya hay al menos un producto con un plan de Whop asociado, así que el plan existe.'
          : 'Todavía no hay ningún producto con whop_plan_id: o falta crear el plan en Whop, o falta cargarlo acá.',
    },
    {
      numero: 4,
      titulo: 'Cargar los productos',
      descripcion:
        'En /admin/productos (o con "Catálogo de Whop", que los trae por API), cada producto con su whop_plan_id.',
      href: '/admin/productos',
      textoLink: 'Ir a Productos',
      hecho: s.productosConPlan > 0,
      detalle:
        s.productosConPlan > 0
          ? `${s.productosConPlan} producto${s.productosConPlan === 1 ? '' : 's'} con plan de Whop.`
          : 'Ningún producto tiene whop_plan_id todavía.',
    },
    {
      numero: 5,
      titulo: 'Armar el funnel',
      descripcion:
        'En /admin/funnels: un paso "front" (se cobra en /pagos/<slug> con el embed de Whop) y al menos un paso "upsell" (se cobra one-click desde el funnel externo, con su url_externa apuntando a la página de la oferta).',
      href: '/admin/funnels',
      textoLink: 'Ir a Funnels',
      hecho: s.hayFunnelConFrontYUpsell,
      detalle: s.hayFunnelConFrontYUpsell
        ? 'Hay un funnel con al menos un paso front y un paso upsell.'
        : 'Todavía no hay ningún funnel con un front y un upsell juntos.',
    },
    {
      numero: 6,
      titulo: 'Autorizar el dominio del funnel',
      descripcion:
        'En /admin/origenes: la allowlist de CORS del cobro one-click. Va el origen exacto (esquema + host, SIN path) del dominio donde vive el funnel. Sin esto el cobro del upsell devuelve 403.',
      href: '/admin/origenes',
      textoLink: 'Ir a Orígenes',
      hecho: s.origenesActivos > 0,
      detalle:
        s.origenesActivos > 0
          ? `${s.origenesActivos} origen${s.origenesActivos === 1 ? '' : 'es'} activo${s.origenesActivos === 1 ? '' : 's'}.`
          : 'Ningún origen está activo todavía.',
    },
    {
      numero: 7,
      titulo: 'Pegar el código en el funnel',
      descripcion:
        'El script de loader.js en el <head> de todas las páginas, y en cada página de upsell un botón con data-hilvana-upsell="<slug>". La pantalla de cada funnel ya genera ese código listo para copiar — no hace falta escribirlo a mano.',
      href: '/admin/funnels',
      textoLink: 'Ver snippets del funnel',
      // No hay forma de verificar desde la base si el HTML se pegó en un sitio
      // externo: eso vive fuera de este servicio. Se infiere completo cuando ya
      // hay al menos un cobro (si cobró, es porque el botón funcionó).
      hecho: s.cobrosPagados > 0,
      detalle:
        s.cobrosPagados > 0
          ? 'Ya hubo al menos un cobro, así que el código está pegado y funcionando.'
          : 'No se puede verificar desde acá si ya lo pegaste. Se marca hecho automáticamente en cuanto entre el primer cobro.',
    },
    {
      numero: 8,
      titulo: 'Encender',
      descripcion:
        'Todo nace apagado a propósito: hay que prender el switch del funnel, el de sus páginas, y el de los orígenes autorizados. El freno de emergencia es apagar el funnel: corta toda la cadena al instante.',
      href: '/admin/funnels',
      textoLink: 'Ir a Funnels',
      hecho: s.funnelsActivos > 0 && s.origenesActivos > 0,
      detalle:
        s.funnelsActivos > 0 && s.origenesActivos > 0
          ? 'Hay al menos un funnel y un origen encendidos.'
          : 'Falta encender el funnel, algún origen, o los dos.',
    },
    {
      numero: 9,
      titulo: 'Probar con una compra real',
      descripcion:
        'Comprá el front, vas a ser redirigido con ?ot=<token>, apretá el botón del upsell. Para no esperar el VSL podés poner ?offer=now en la url_externa del paso: el checkout le agrega &ot= sin pisarlo.',
      href: '/admin/cobros',
      textoLink: 'Ver cobros',
      hecho: s.cobrosPagados > 0,
      detalle:
        s.cobrosPagados > 0
          ? `${s.cobrosPagados} cobro${s.cobrosPagados === 1 ? '' : 's'} pagado${s.cobrosPagados === 1 ? '' : 's'}. El módulo ya cobró de verdad.`
          : 'Todavía no hay ningún cobro pagado.',
    },
  ];
}

/**
 * Le agrega a cada paso su `estado`: 'hecho', 'siguiente' (el primero no hecho:
 * el "seguí por acá") o 'pendiente' (no hecho, pero no es el próximo). Solo
 * puede haber UN paso 'siguiente' — o ninguno, si ya está todo hecho.
 */
export function pasosConEstado(s: SnapshotTutorial): PasoConEstado[] {
  const pasos = pasosTutorial(s);
  const indiceSiguiente = pasos.findIndex((p) => !p.hecho);

  return pasos.map((p, i) => ({
    ...p,
    estado: p.hecho ? 'hecho' : i === indiceSiguiente ? 'siguiente' : 'pendiente',
  }));
}

/** Cuántos de los 9 pasos están hechos. Para la barra de progreso. */
export function progreso(s: SnapshotTutorial): { hechos: number; total: number } {
  const pasos = pasosTutorial(s);
  return { hechos: pasos.filter((p) => p.hecho).length, total: pasos.length };
}

/** El paso a destacar como "seguí por acá". `null` si ya está todo hecho. */
export function pasoSiguiente(s: SnapshotTutorial): PasoConEstado | null {
  return pasosConEstado(s).find((p) => p.estado === 'siguiente') ?? null;
}

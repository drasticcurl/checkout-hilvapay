/**
 * Genera el código que hay que pegar en el funnel para que sus botones cobren.
 *
 * Por qué existe: el funnel vive en OTRO repo y en OTRO dominio, y lo único que
 * lo conecta con este servicio son tres strings — la URL del loader, el `slug`
 * de cada paso, y el atributo `data-hilvana-upsell`. Los tres se escriben a
 * mano, ninguno de los tres falla de forma visible, y los tres los sabe el panel
 * con certeza. Un slug mal tipeado da 404 en `/api/upsell/cobrar` recién cuando
 * un comprador real hace click; un slug copiado del paso equivocado **cobra el
 * producto equivocado sin ningún error**. Eso ya pasó con KashPay (ver el
 * comentario de `KashPayUpsell3Button.tsx` en el funnel: tres URLs casi iguales
 * y la advertencia de no copiar una sobre otra).
 *
 * Así que el panel no explica cómo armar el código: lo entrega armado.
 *
 * Todo acá es una función pura de string a string. Sin base, sin red, sin
 * `process.env`: la base pública entra por parámetro. Es lo que permite probar
 * el HTML exacto que se le va a dar al usuario, que es la única forma de que
 * "el snippet está bien" sea una afirmación verificable y no una esperanza.
 */

/** Un paso del funnel, reducido a lo que hace falta para generar su botón. */
export type PasoParaSnippet = {
  slug: string;
  tipo: 'front' | 'upsell';
  /** Nombre interno del paso ("Upsell 1"). Puede faltar. */
  nombre: string | null;
  /** Dónde vive la oferta, en el dominio del funnel. NULL en el paso `front`. */
  url_externa: string | null;
  permite_rechazo: boolean;
  producto: { nombre: string; precio: string; moneda: string };
};

/** El bloque de código de un paso, listo para mostrar con un botón de copiar. */
export type SnippetDePaso = {
  slug: string;
  /** Cómo llamarlo en pantalla: el nombre del paso, o el del producto. */
  titulo: string;
  /** "US$ 19,90" */
  precio: string;
  /** La página del funnel donde va este botón. NULL si el paso no la tiene configurada. */
  urlExterna: string | null;
  /** La misma URL con `offer=now`, para ver la oferta sin esperar el VSL. */
  urlDePrueba: string | null;
  /** HTML plano: Shopify, Framer, una landing suelta. */
  html: string;
  /** JSX para un funnel en React/Next, que es el caso de este stack. */
  jsx: string;
  /**
   * El mismo paso con el botón de wallet (Apple Pay / Google Pay / Whop Pay) en
   * vez del botón que cobra off-session. **Es el recomendado hoy**: el
   * off-session está bloqueado del lado de Whop (ver `snippetWalletHtml`), y este
   * camino cubre wallet Y tarjeta con un solo botón.
   */
  htmlWallet: string;
  /** Lo mismo en JSX. */
  jsxWallet: string;
  /** true si al paso le falta `url_externa` y por eso no se puede integrar todavía. */
  incompleto: boolean;
};

/** Todo lo que necesita la pantalla de "cómo integrar". */
export type Integracion = {
  /** El `<script>` del loader, que va una sola vez por funnel. */
  loader: string;
  /** El mismo loader para un funnel en Next.js (App Router). */
  loaderNext: string;
  /** La URL del loader sola, para mostrarla o copiarla suelta. */
  urlLoader: string;
  /**
   * false cuando `NEXT_PUBLIC_BASE_URL` no está configurada o no es absoluta.
   *
   * Es su propio campo y no algo que la pantalla deduzca mirando el string,
   * porque el modo de falla es el peor posible: con la base vacía el snippet sale
   * como `<script src="/loader.js">`, que es una URL **relativa**. Pegada en el
   * funnel apunta al dominio DEL FUNNEL, que no sirve ese archivo: 404, sin
   * `window.hilvana`, y los botones dejan de cobrar sin un solo error que
   * mencione la causa. Un snippet así no se puede mostrar como si estuviera bien.
   */
  baseConfigurada: boolean;
  /** El origen que hay que autorizar en `/admin/origenes`, derivado de los pasos. */
  origenesNecesarios: string[];
  /** Un bloque por paso de upsell. El `front` no lleva botón: su checkout es de este lado. */
  pasos: SnippetDePaso[];
};

/** true si la base es una URL absoluta usable en el `src` de un script ajeno. */
export function baseEsAbsoluta(base: string): boolean {
  const b = normalizarBase(base);
  if (!b) return false;
  try {
    const u = new URL(b);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Normaliza la base pública a un origen sin barra final.
 *
 * `NEXT_PUBLIC_BASE_URL` la escribe una persona en un `.env`, así que llega con
 * barra final la mitad de las veces. Sin esto el snippet sale con
 * `https://pay.hilvanapp.com//loader.js`, que funciona en Caddy y no en todos los
 * proxies — y sobre todo se ve mal en algo que el usuario va a copiar y pegar
 * como si fuera correcto.
 */
export function normalizarBase(base: string): string {
  return base.trim().replace(/\/+$/, '');
}

/**
 * El origen (`https://host`) de una URL, o `null` si no es una URL válida.
 *
 * Se usa para decirle al usuario qué dominio exacto tiene que autorizar en
 * `/admin/origenes`. El header `Origin` que manda el browser en el POST del
 * cobro es exactamente esto — esquema + host + puerto, sin path — así que
 * derivarlo de la `url_externa` que ya está en la base es más confiable que
 * pedirle que lo escriba de nuevo. Un `https://funnel.com/upsell` copiado
 * entero en la allowlist no matchea nunca y el 403 no dice por qué.
 */
export function origenDeUrl(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Agrega `offer=now` a una URL respetando el querystring que ya tenga.
 *
 * `new URL` + `searchParams.set`, igual que `armarUrlConToken` y
 * `resolverSiguienteUrl`. Y esa simetría es la que hace que esto sirva para
 * testear: cuando el checkout redirige al upsell le agrega `ot` con el mismo
 * mecanismo, así que un `offer=now` que ya esté en la URL **sobrevive** y las
 * dos terminan conviviendo — `?offer=now&ot=<token>`.
 *
 * Es la diferencia con KashPay, y vale explicarla porque cambia cómo se testea:
 * antes `?offer=now` revelaba el precio pero no el botón, porque el botón lo
 * inyectaba su script a los 360 s de reloj de pared y ese contador no se podía
 * tocar (está documentado en `VslOfferBlockLatam.tsx`). Acá el botón es HTML del
 * funnel: se revela con el resto del bloque, en el mismo instante.
 */
export function urlConOfertaInmediata(url: string): string | null {
  try {
    const u = new URL(url);
    u.searchParams.set('offer', 'now');
    return u.toString();
  } catch {
    return null;
  }
}

/** "US$ 19,90" — el mismo formato que usa el editor de funnels. */
export function formatearPrecio(precio: string, moneda: string): string {
  const simbolo = moneda.toUpperCase() === 'USD' ? 'US$' : moneda.toUpperCase();
  const n = Number(precio);
  const monto = Number.isFinite(n) ? n.toFixed(2) : precio;
  return `${simbolo} ${monto.replace('.', ',')}`;
}

/**
 * El `<script>` del loader para un `<head>` de HTML plano.
 *
 * SIN `defer` y sin `async`, a propósito. El loader guarda el `?ot=` de la URL
 * en `sessionStorage` en cuanto corre, y engancha el listener de click en
 * `document`. Con `defer` sigue funcionando, pero abre una ventana en la que la
 * página ya está pintada y un click temprano en el botón no cobra: el listener
 * todavía no existe. El script son ~4 kB y no bloquea red (mismo dominio,
 * cacheado 300 s), así que la ventana no vale el ahorro.
 */
export function snippetLoader(base: string): string {
  return `<script src="${normalizarBase(base)}/loader.js"></script>`;
}

/**
 * El loader para un funnel en Next.js (App Router).
 *
 * `beforeInteractive` es el equivalente de un `<script>` síncrono en el `<head>`
 * y es la única estrategia que garantiza que `window.hilvana` exista antes de
 * que hidrate el primer botón. Next exige que viva en un `layout.tsx` (o en el
 * root layout): puesto dentro de una página, Next lo degrada a `afterInteractive`
 * con un warning en consola que es fácil no ver.
 */
export function snippetLoaderNext(base: string): string {
  return `// app/layout.tsx
import Script from 'next/script';

// ...dentro del <body>, o del <head>:
<Script
  src="${normalizarBase(base)}/loader.js"
  strategy="beforeInteractive"
/>`;
}

/**
 * El botón de aceptar, en HTML plano.
 *
 * `data-hilvana-upsell` es el contrato entero: el loader tiene un listener de
 * click en `document` que sube por los padres del elemento clickeado buscando
 * ese atributo. Por eso el botón puede tener cualquier clase, cualquier estilo y
 * cualquier estructura interna (un `<span>` con el precio adentro, un icono):
 * el click sobre un hijo funciona igual.
 *
 * `type="button"` porque un `<button>` sin type dentro de un `<form>` es
 * `submit`, y un submit recarga la página en medio del cobro.
 */
export function snippetBotonHtml(paso: PasoParaSnippet, precio: string): string {
  const etiqueta = `Sí, quiero — ${precio}`;
  return `<button type="button" data-hilvana-upsell="${paso.slug}">
  ${etiqueta}
</button>`;
}

/**
 * El botón de aceptar, en JSX.
 *
 * Es idéntico al HTML salvo `className`, y eso es exactamente lo que se quiere
 * mostrar: no hay componente propio, no hay hook, no hay `onClick`. Con KashPay
 * había que escribir un `onClick={() => window.acceptUpsell?.(url)}` porque su
 * script generaba un `onclick` literal que React ignora. Acá no: el atributo
 * `data-*` sobrevive a la hidratación de React y lo lee el listener global, así
 * que el botón puede ser un server component.
 */
export function snippetBotonJsx(paso: PasoParaSnippet, precio: string): string {
  const etiqueta = `Sí, quiero — ${precio}`;
  return `<button
  type="button"
  data-hilvana-upsell="${paso.slug}"
  className="tu-clase-de-boton"
>
  ${etiqueta}
</button>`;
}

/**
 * El botón de wallet: Apple Pay, Google Pay o Whop Pay, en HTML plano.
 *
 * ── Por qué existe, y por qué es el recomendado hoy ──────────────────────────
 * `data-hilvana-upsell` cobra por `POST /api/upsell/cobrar`, que hace un cobro
 * off-session contra la tarjeta guardada. **Ese camino está bloqueado del lado de
 * Whop**: devuelve `400 bad_request` genérico, sin `decline_code`, sin crear
 * ningún Payment, y rechazando en 66 ms — o sea antes de llegar al procesador.
 * Medido el 2026-09-11 en tres versiones de API (`2026-08-21-1`, `2026-09-02-1`
 * y `2026-09-11`), con `capture:false`, y con `payment:charge` confirmado como
 * concedido por el propio endpoint de permisos de Whop. Nueve hipótesis
 * descartadas; ver `tasks/checkout-whop/DIAGNOSTICO-ONE-CLICK.md`.
 *
 * `data-hilvana-wallet` no pasa por ahí. Le pide una sesión al server y monta el
 * botón express de Whop, que cobra por el camino on-session — el único que
 * funciona hoy.
 *
 * ── Un botón, y cubre tarjeta ───────────────────────────────────────────────
 * Es UN elemento, no tres. Whop elige el método según el browser:
 *
 *   · Safari con una tarjeta en el Wallet  → Apple Pay, se aprueba con Face ID
 *   · Chrome / Android con Google Pay      → Google Pay, sin diálogo
 *   · Todo lo demás                        → **Whop Pay**, un diálogo que acepta
 *                                             tarjeta tipeada
 *
 * Por eso no hace falta dejar el botón viejo al lado "para los que no tienen
 * wallet": Whop Pay ES el caso de la tarjeta. El loader no manda el atributo
 * `methods`, así que quedan habilitados los tres — restringirlo a `apple-pay` es
 * lo único que puede dejar la página sin ningún botón.
 *
 * ── Y resuelve la autenticación del banco ───────────────────────────────────
 * El wallet resuelve el 3DS en el dispositivo (Face ID, PIN). El cobro
 * off-session no puede: su `client_secret` viene `null`, así que no hay forma de
 * continuar un desafío. Es la misma limitación que tiene KashPay, que con Whop
 * tira una excepción cuando el pago pide autenticación.
 *
 * Es un `<div>` vacío y no un `<button>` a propósito: el loader le mete adentro
 * el custom element `<whop-express-checkout-button>`, que trae su propio botón
 * con el estilo nativo de cada wallet. Apple no permite reestilar el suyo.
 */
export function snippetWalletHtml(paso: PasoParaSnippet): string {
  return `<div data-hilvana-wallet="${paso.slug}"></div>`;
}

/**
 * El botón de wallet en JSX.
 *
 * Igual que el HTML: un div vacío con el `data-*`. React no toca los atributos
 * `data-*` al hidratar, y el custom element que el loader inyecta adentro queda
 * fuera del árbol que React administra, así que no hay conflicto de hidratación.
 */
export function snippetWalletJsx(paso: PasoParaSnippet): string {
  return `<div data-hilvana-wallet="${paso.slug}" />`;
}

/**
 * El link de rechazo: un `<a href>` común al destino que decidió el panel.
 *
 * NO usa `data-hilvana-rechazo` ni `window.hilvana.rechazarUpsell()`, y la razón
 * es que no aportan nada acá. `rechazarUpsell(slug)` lee el atributo
 * `data-hilvana-rechazo` **del botón de aceptar de ese slug** y navega ahí: el
 * destino lo escribe igual el funnel en su propio HTML, así que pasar por el
 * loader agrega una dependencia de JS a una navegación que un `<a>` hace sola,
 * sin JS y con click derecho → abrir en pestaña nueva.
 *
 * Se sigue exponiendo en el loader por compatibilidad con quien ya la use.
 */
export function snippetRechazo(destino: string | null): string {
  const href = destino ?? '/downsell';
  return `<a href="${href}">No, gracias</a>`;
}

/**
 * Arma la guía completa de un funnel.
 *
 * `pasosDestinoRechazo` mapea `slug → url del paso al que va el rechazo`, para
 * que el `<a href>` del "no gracias" apunte a donde dice el editor y no a un
 * placeholder. Se pasa resuelto desde afuera porque acá no hay acceso a la base:
 * resolver `paso_rechazado_id` es una query, y este módulo es puro.
 */
export function integracionDeFunnel(
  base: string,
  pasos: PasoParaSnippet[],
  pasosDestinoRechazo: Record<string, string | null> = {},
): Integracion {
  const b = normalizarBase(base);

  const upsells = pasos.filter((p) => p.tipo === 'upsell');

  const snippets: SnippetDePaso[] = upsells.map((paso) => {
    const precio = formatearPrecio(paso.producto.precio, paso.producto.moneda);
    return {
      slug: paso.slug,
      titulo: paso.nombre ?? paso.producto.nombre,
      precio,
      urlExterna: paso.url_externa,
      urlDePrueba: paso.url_externa ? urlConOfertaInmediata(paso.url_externa) : null,
      html: [
        snippetBotonHtml(paso, precio),
        '',
        paso.permite_rechazo ? snippetRechazo(pasosDestinoRechazo[paso.slug] ?? null) : null,
      ]
        .filter((l) => l !== null)
        .join('\n')
        .trimEnd(),
      jsx: [
        snippetBotonJsx(paso, precio),
        '',
        paso.permite_rechazo ? snippetRechazo(pasosDestinoRechazo[paso.slug] ?? null) : null,
      ]
        .filter((l) => l !== null)
        .join('\n')
        .trimEnd(),
      // El bloque de wallet lleva el mismo link de rechazo: el "no gracias" es
      // del funnel y no depende de con qué se cobre.
      htmlWallet: [
        snippetWalletHtml(paso),
        '',
        paso.permite_rechazo ? snippetRechazo(pasosDestinoRechazo[paso.slug] ?? null) : null,
      ]
        .filter((l) => l !== null)
        .join('\n')
        .trimEnd(),
      jsxWallet: [
        snippetWalletJsx(paso),
        '',
        paso.permite_rechazo ? snippetRechazo(pasosDestinoRechazo[paso.slug] ?? null) : null,
      ]
        .filter((l) => l !== null)
        .join('\n')
        .trimEnd(),
      incompleto: !paso.url_externa,
    };
  });

  // Los dominios a autorizar salen de las `url_externa` de los pasos: son los
  // orígenes desde los que el browser va a postear el cobro. Únicos y ordenados
  // para que la lista no baile entre renders.
  const origenes = new Set<string>();
  for (const paso of upsells) {
    if (!paso.url_externa) continue;
    const origen = origenDeUrl(paso.url_externa);
    if (origen) origenes.add(origen);
  }

  return {
    loader: snippetLoader(b),
    loaderNext: snippetLoaderNext(b),
    urlLoader: `${b}/loader.js`,
    baseConfigurada: baseEsAbsoluta(b),
    // `Array.from` y no `[...origenes]`: el `target` del tsconfig es ES5 y el
    // spread de un Set exige `downlevelIteration`. Compila igual y no obliga a
    // tocar la config del proyecto por una línea.
    origenesNecesarios: Array.from(origenes).sort(),
    pasos: snippets,
  };
}

/**
 * Un paso tal como lo devuelve `lib/admin/funnels.ts`, con los ids que hacen
 * falta para seguir la flecha del rechazo.
 */
export type PasoDeFunnelParaSnippet = PasoParaSnippet & {
  id: string;
  paso_rechazado_id: string | null;
};

/**
 * `slug → URL a la que va el "no gracias"`, siguiendo `paso_rechazado_id`.
 *
 * Se resuelve acá y no en la pantalla porque es la clase de mapeo que se escribe
 * mal en silencio: si el destino se leyera del paso ACTUAL en vez del apuntado,
 * el "no gracias" mandaría a la propia oferta que se acaba de rechazar y el
 * comprador quedaría en un bucle. La migración 003 es explícita en que la URL
 * sale del paso DESTINO, no del paso actual.
 *
 * Un `paso_rechazado_id` en NULL o apuntando a un paso que ya no está deja el
 * slug fuera del mapa: el snippet cae al placeholder `/downsell` en vez de a un
 * `href` vacío, que recargaría la página.
 */
export function destinosDeRechazo(
  pasos: PasoDeFunnelParaSnippet[],
): Record<string, string | null> {
  const urlPorId = new Map(pasos.map((p) => [p.id, p.url_externa]));
  const mapa: Record<string, string | null> = {};
  for (const paso of pasos) {
    if (!paso.permite_rechazo || !paso.paso_rechazado_id) continue;
    mapa[paso.slug] = urlPorId.get(paso.paso_rechazado_id) ?? null;
  }
  return mapa;
}

/**
 * El atajo que usan las pantallas: pasos de la base → guía completa, con los
 * destinos de rechazo ya resueltos. Una sola llamada, para que ninguna pantalla
 * tenga que acordarse de armar el segundo argumento.
 */
export function integracionDesdeFunnel(
  base: string,
  pasos: PasoDeFunnelParaSnippet[],
): Integracion {
  return integracionDeFunnel(base, pasos, destinosDeRechazo(pasos));
}

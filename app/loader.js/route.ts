/**
 * GET /loader.js — el script que los funnels embeben en el `<head>`.
 *
 * Contrato congelado: §6 del plan. Se sirve como route handler (no como
 * archivo estático de `public/`) para que el script pueda leer su propio
 * origen del lado del server sin hardcodear el dominio en dos lugares — si
 * mañana cambia `pay.hilvanapp.com`, este archivo no necesita tocarse.
 *
 * Es la ÚNICA pieza de este repo que corre en el dominio de un funnel ajeno,
 * el que factura. Por eso:
 *   - vanilla JS, sin dependencias, sin transpilar — menos código, menos
 *     superficie de un bug que rompa la página de otro.
 *   - ninguna excepción puede escapar sin capturar: un error de JS no
 *     capturado puede tumbar el resto del JS de esa página, incluido el pixel
 *     de tracking del funnel.
 *   - guarda el token en `sessionStorage`, nunca en un storage que sobreviva
 *     al cierre del browser (regla 1 de §6): en una computadora compartida
 *     eso dejaría el cobro habilitado para la próxima persona que se sentara
 *     ahí.
 *   - no manda tracking. Eso es del funnel.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return new NextResponse(SCRIPT, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      // Este GET sirve un archivo público, no cobra nada: `*` es correcto
      // ACÁ. El POST del cobro (app/api/upsell/cobrar) es el que jamás puede
      // ser `*` — ese endpoint es el que valida contra `origenes`.
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// Se define como string y no como archivo .js aparte: así no hay que
// configurar un segundo pipeline de build para un solo archivo, y el
// `ORIGEN_CHECKOUT` se puede inyectar en runtime desde una env var del server
// en vez de hardcodearlo en un asset estático.
const ORIGEN_CHECKOUT = process.env.NEXT_PUBLIC_CHECKOUT_ORIGIN ?? '';

const SCRIPT = `
(function () {
  'use strict';

  // Todo el script vive dentro de este único try/catch de nivel superior.
  // Un error de JS no capturado en la página de un funnel puede tumbar el
  // resto de los scripts de esa página, incluido el pixel de tracking — y
  // este archivo no es dueño de esa página, así que fallar en silencio es
  // siempre mejor que fallar ruidoso.
  try {
    var ORIGEN_CHECKOUT = ${JSON.stringify(ORIGEN_CHECKOUT)};
    var CLAVE_TOKEN = 'hilvana_ot';
    var INTENTOS_POLLING = 15;
    var INTERVALO_POLLING_MS = 1000;

    var cobroEnCurso = false;

    function base() {
      // Si no se configuró NEXT_PUBLIC_CHECKOUT_ORIGIN, se usa el origen desde
      // donde se sirvió este mismo script — se busca el <script> cuyo src
      // contiene /loader.js. Evita hardcodear el dominio dos veces.
      if (ORIGEN_CHECKOUT) return ORIGEN_CHECKOUT;
      try {
        var scripts = document.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
          var src = scripts[i].src || '';
          if (src.indexOf('/loader.js') !== -1) {
            return new URL(src).origin;
          }
        }
      } catch (e) {}
      return '';
    }

    function leerTokenDeURL() {
      try {
        var params = new URLSearchParams(window.location.search);
        return params.get('ot');
      } catch (e) {
        return null;
      }
    }

    function guardarToken(token) {
      // Se usa sessionStorage y nada de lo que persista entre pestañas o
      // cierres del browser: el token habilita cobrar una tarjeta guardada, y
      // un storage que sobrevive al cierre del browser dejaría el cobro
      // habilitado para la próxima persona que use esta misma computadora.
      try {
        window.sessionStorage.setItem(CLAVE_TOKEN, token);
      } catch (e) {
        // Modo privado en algunos browsers puede tirar en setItem. No hay
        // fallback: sin poder guardar el token, simplemente no hay one-click
        // en esta sesión, y no es un error que haya que mostrar.
      }
    }

    function token() {
      try {
        var deLaURL = leerTokenDeURL();
        if (deLaURL) {
          guardarToken(deLaURL);
          return deLaURL;
        }
        return window.sessionStorage.getItem(CLAVE_TOKEN);
      } catch (e) {
        return null;
      }
    }

    /**
     * "texto" es el mensaje mientras está en vuelo ("Procesando..."). Cuando se
     * quiere DEJAR el botón operable de nuevo (habilitar) hay que restaurar el
     * texto original, no dejarlo en null: un botón que dice "Procesando..." para
     * siempre, mientras adentro ya no está deshabilitado, es el bug que costó
     * una compra real el 2026-09-13 — el cobro había salido bien (Whop lo tenía
     * "pagado"), pero sin "siguienteUrl" configurado el loader caía a "avisar y
     * quedarse", y el texto nunca volvía a ser el original.
     */
    function deshabilitar(boton, texto) {
      try {
        if (boton && boton.setAttribute) {
          boton.setAttribute('disabled', 'disabled');
          if (texto) boton.textContent = texto;
        }
      } catch (e) {}
    }

    /**
     * Vuelve el botón a como estaba antes de tocarlo: habilitado y con su texto
     * original. Se usa en los caminos donde el cobro NO avanza a ningún lado
     * (falló sin poder recuperar, o no hay destino configurado) — es la
     * contraparte de "deshabilitar", y existe porque "deshabilitar(boton, null)"
     * + "removeAttribute('disabled')" deja el atributo bien pero el texto
     * pegado en "Procesando...".
     */
    function habilitar(boton) {
      try {
        if (!boton) return;
        boton.removeAttribute('disabled');
        if (boton.hasAttribute && boton.hasAttribute('data-hilvana-texto-original')) {
          boton.textContent = boton.getAttribute('data-hilvana-texto-original');
        }
      } catch (e) {}
    }

    function irA(url) {
      try {
        if (url) window.location.href = url;
      } catch (e) {}
    }

    function botonDelSlug(slug) {
      try {
        return document.querySelector('[data-hilvana-upsell="' + slug + '"]');
      } catch (e) {
        return null;
      }
    }

    async function cobrar(slug) {
      var b = base();
      var resp = await fetch(b + '/api/upsell/cobrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token(), slug: slug }),
      });
      var data = await resp.json().catch(function () { return {}; });
      return data;
    }

    async function pollear(cobroId) {
      var b = base();
      for (var i = 0; i < INTENTOS_POLLING; i++) {
        await new Promise(function (r) { setTimeout(r, INTERVALO_POLLING_MS); });
        try {
          var resp = await fetch(b + '/api/cobros/' + encodeURIComponent(cobroId));
          var data = await resp.json().catch(function () { return null; });
          if (data && (data.estado === 'pagado' || data.estado === 'fallido' || data.estado === 'requiere_tarjeta')) {
            return data;
          }
        } catch (e) {
          // Un poll que falla no corta el ciclo: se sigue intentando hasta
          // agotar INTENTOS_POLLING.
        }
      }
      return null; // se agotaron los intentos sin resolverse
    }

    /**
     * Esconde el botón verde una vez que Whop Pay tomó el control.
     *
     * Los dos juntos son el "dos botones parten la atención" que el requisito de
     * producto rechaza — y además el verde ya no sirve: su cobro es el que acaba de
     * fallar, tocarlo otra vez repite el mismo 400.
     */
    function ocultar(el) {
      try { if (el) el.style.display = 'none'; } catch (e) {}
    }

    /**
     * Abre el diálogo de Whop Pay sobre la página del funnel, con el email ya
     * cargado, cuando el cobro silencioso no pudo.
     *
     * ── Por qué esto y no el redirect ─────────────────────────────────────────
     * Antes, un cobro que devolvía \`requiere_tarjeta\` mandaba al comprador a
     * \`/pagos/<slug>?ot=...&r=1\`: otra página, otro dominio, y la oferta del funnel
     * desaparecía de la pantalla. Eso es exactamente la "pantalla intermedia" que
     * el requisito de producto rechaza. Acá el comprador se queda donde está.
     *
     * ── Por qué SOLO whop-pay, y no los tres métodos ──────────────────────────
     * Apple Pay y Google Pay abren una hoja del sistema operativo, y el browser
     * solo la deja abrir **desde el gesto del usuario**. Acá el gesto ya se
     * consumió tocando el botón verde y esperando la respuesta del server, así que
     * una hoja de wallet abierta por código queda bloqueada. Whop Pay es un
     * diálogo en la propia página —DOM, no sistema operativo— y ese sí se puede
     * abrir después.
     *
     * Pedir \`methods="whop-pay"\` es estricto a propósito: la doc aclara que un
     * botón restringido NUNCA cae a otro método, así que no hay riesgo de que
     * intente abrir una hoja bloqueada.
     *
     * ── Degrada en vez de romperse ────────────────────────────────────────────
     * Que un diálogo se pueda abrir con un click sintético NO está documentado: si
     * Whop mira \`event.isTrusted\`, lo ignora. Por eso el botón se monta VISIBLE y
     * el click programático es un intento encima. Si funciona, el comprador no hace
     * nada más. Si no, el botón está ahí con el mensaje al lado y toca una vez más
     * — un toque extra, en la misma página, en vez de un redirect.
     */
    async function abrirWhopPay(slug, contenedorRef, sesionPrecargada) {
      // Si ya se resolvió antes del click (ver precargarSesionesDeLaPagina),
      // se usa esa: cero await entre el gesto del comprador y el intento de
      // abrir el diálogo — la única ventana en la que el navegador acepta
      // abrir la hoja de wallet sin que sea el usuario quien la dispare.
      // Si no vino, se pide en el momento (comportamiento de siempre: el
      // camino sin_metodo_guardado ya rompió la cadena de gesto un paso
      // antes con el await cobrar(slug), así que acá no cambia nada perderla
      // de nuevo).
      var sesion = sesionPrecargada || (await pedirSesion(slug));
      if (!sesion || !sesion.sessionId) {
        console.log('[hilvana] whop-pay(' + slug + '): sin sesión', sesion);
        return false;
      }

      await cargarScriptWhop();

      // El contenedor va donde estaba el botón verde, para que la oferta no se
      // mueva de lugar debajo del dedo del comprador.
      var host = document.createElement('div');
      host.setAttribute('data-hilvana-whop-pay', slug);
      host.style.marginTop = '10px';

      var ancla = contenedorRef && contenedorRef.parentNode ? contenedorRef : null;
      if (ancla) ancla.parentNode.insertBefore(host, ancla.nextSibling);
      else document.body.appendChild(host);

      var boton = document.createElement('whop-express-checkout-button');
      boton.setAttribute('checkout-configuration-id', sesion.sessionId);
      boton.setAttribute('return-url', window.location.href);
      boton.setAttribute('methods', 'whop-pay');
      boton.setAttribute('theme', 'light');
      boton.setAttribute('skip-redirect', 'true');
      boton.setAttribute('setup-future-usage', 'off_session');
      if (sesion.email) boton.setAttribute('prefill-email', sesion.email);

      boton.addEventListener('complete', async function (ev) {
        var recibo = ev && ev.detail ? (ev.detail.receiptOrSetupIntentId || ev.detail.receiptId) : null;
        if (!recibo) {
          console.log('[hilvana] whop-pay(' + slug + '): completó sin recibo', ev && ev.detail);
          return;
        }
        try {
          var res = await confirmar(slug, recibo);
          if (res && res.siguienteUrl) { irA(res.siguienteUrl); return; }
          console.log('[hilvana] whop-pay(' + slug + '): confirmado sin siguiente URL', res);
        } catch (e) {
          console.log('[hilvana] whop-pay(' + slug + '): error confirmando', e);
        }
      });

      boton.addEventListener('payment-error', function (ev) {
        var d = ev && ev.detail ? ev.detail : {};
        console.log('[hilvana] whop-pay(' + slug + '): error de pago', d);
        mostrarErrorDePago(host, d.message, d.code);
      });

      host.appendChild(boton);

      // El intento de abrirlo solo. \`ready\` avisa cuando el custom element se
      // midió y está usable; sin esperarlo, el click cae en un elemento que
      // todavía no tiene nada adentro.
      var abierto = false;
      boton.addEventListener('overlay-open', function () { abierto = true; });
      boton.addEventListener('ready', function () {
        try { boton.click(); } catch (e) {}
      });

      // Si a los 1200 ms el diálogo no se abrió, se le dice al comprador que
      // toque. Es el camino degradado, y tiene que ser explícito: un botón nuevo
      // que aparece sin explicación después de un "Procesando..." se lee como que
      // algo falló.
      setTimeout(function () {
        if (abierto) return;
        mostrarErrorDePago(
          host,
          'Tu banco necesita que confirmes esta compra. Tocá el botón de acá abajo, es un solo paso.',
          null,
        );
      }, 1200);

      return true;
    }

    async function aceptarUpsell(slug) {
      if (cobroEnCurso) return; // primera defensa contra el doble click
      if (typeof slug !== 'string' || !slug) return;

      var t = token();
      var boton = botonDelSlug(slug);

      if (!t) {
        // Alguien llegó a esta página del upsell sin haber comprado (un link
        // directo, por ejemplo). No es un error de JS: se loguea y no se
        // rompe nada visible.
        console.log('[hilvana] aceptarUpsell(' + slug + '): sin token, no se cobra');
        return;
      }

      cobroEnCurso = true;
      // Guarda el texto que tenía el botón ANTES de pisarlo con "Procesando...",
      // así habilitar() lo puede restaurar más abajo si el cobro no termina
      // en un redirect. Solo la primera vez: un reintento no debe guardar
      // "Procesando..." como si fuera el original.
      if (boton && boton.setAttribute && !boton.hasAttribute('data-hilvana-texto-original')) {
        boton.setAttribute('data-hilvana-texto-original', boton.textContent || '');
      }

      // ── Wallet directo, sin pasar por el cobro silencioso ────────────────
      //
      // Si el FRONT se pagó con Apple Pay o Google Pay, el método guardado es
      // un DPAN atado al dispositivo: por diseño de la red, exige
      // autenticación biométrica en cada cobro, así que un intento
      // off-session (data-hilvana-upsell normal) va a fallar siempre — no es
      // una posibilidad, es la garantía documentada del propio wallet.
      //
      // En vez de intentarlo igual y esperar el fallo para recién ahí mostrar
      // Whop Pay (lo que hacía este mismo botón hasta ahora), se va DIRECTO
      // al wallet si sesionCacheada ya sabe que el front fue wallet — la
      // sesión, precargada al entrar a la página, ya está resuelta en
      // memoria, así que no hay ningún await entre este click y el intento de
      // abrir la hoja: es la misma ventana de gesto que usa el botón de
      // wallet de la pantalla de recuperación.
      var sesionPromesa = sesionesPorSlug[slug];
      if (sesionPromesa) {
        var sesionYaResuelta = null;
        // No se espera la promesa acá (eso sería un await, y rompería la
        // cadena de gesto): se lee su valor SOLO si ya se resolvió antes de
        // este click, que es el caso normal porque se precargó al cargar la
        // página, con tiempo de sobra antes de que el comprador llegue a
        // tocar el botón.
        if (typeof sesionPromesa.hilvanaResuelta !== 'undefined') {
          sesionYaResuelta = sesionPromesa.hilvanaResuelta;
        }
        if (sesionYaResuelta && sesionYaResuelta.metodoFront === 'apple_pay' || sesionYaResuelta && sesionYaResuelta.metodoFront === 'google_pay') {
          deshabilitar(boton, 'Procesando...');
          if (await abrirWhopPay(slug, boton, sesionYaResuelta)) { ocultar(boton); cobroEnCurso = false; return; }
          // No se pudo montar el wallet (script de Whop no cargó, sesión sin
          // sessionId, etc.): se sigue con el camino normal de abajo, que
          // reintenta pedir la sesión y en última instancia redirige.
        }
      }

      deshabilitar(boton, 'Procesando...');

      try {
        var resultado = await cobrar(slug);

        if (resultado && resultado.error === 'sin_metodo_guardado') {
          // Nunca se guardó una tarjeta en la compra del front, así que no hay
          // nada contra qué cobrar en silencio. Whop Pay en la misma página.
          if (await abrirWhopPay(slug, boton)) { ocultar(boton); return; }
          irA(base() + '/pagos/' + encodeURIComponent(slug) + '?ot=' + encodeURIComponent(t) + '&r=1');
          return;
        }

        if (!resultado || !resultado.cobroId) {
          console.log('[hilvana] aceptarUpsell(' + slug + '): respuesta inesperada', resultado);
          habilitar(boton);
          return;
        }

        var final = resultado;
        if (resultado.estado !== 'pagado' && resultado.estado !== 'fallido' && resultado.estado !== 'requiere_tarjeta') {
          var polled = await pollear(resultado.cobroId);
          // A los 15 intentos sin resolverse: avanzar igual. El webhook lo va
          // a resolver del lado del server; dejar a alguien mirando un
          // spinner infinito después de haberle cobrado es peor que avanzar.
          final = polled || resultado;
        }

        if (final.pedirTarjeta && final.estado === 'requiere_tarjeta') {
          // El cobro silencioso no pudo: el banco quiere que el titular confirme.
          // Whop Pay lo resuelve acá mismo, con el email ya cargado, en vez de
          // mandarlo a otra página y hacerle perder de vista la oferta.
          //
          // El redirect queda como último recurso, para el caso en que ni la
          // sesión ni el script de Whop se puedan levantar: es peor perder la
          // venta que mostrar otra pantalla.
          if (await abrirWhopPay(slug, boton)) { ocultar(boton); return; }
          irA(base() + '/pagos/' + encodeURIComponent(slug) + '?ot=' + encodeURIComponent(t) + '&r=1');
          return;
        }

        if (final.siguienteUrl) {
          irA(final.siguienteUrl);
          return;
        }

        // Sin siguienteUrl: quedarse donde está y mostrar el mensaje. No hay
        // UI propia en este script para eso — el funnel decide cómo mostrar
        // el mensaje si lo necesita, leyendo window.hilvana en su propio
        // manejador de click en lugar de data-hilvana-upsell.
        console.log('[hilvana] aceptarUpsell(' + slug + '): ' + (final.mensaje || 'sin siguiente URL'));
        habilitar(boton);
      } catch (e) {
        console.log('[hilvana] aceptarUpsell(' + slug + '): error de red', e);
        habilitar(boton);
      } finally {
        cobroEnCurso = false;
      }
    }

    function rechazarUpsell(slug) {
      try {
        var boton = botonDelSlug(slug);
        var pagina = boton && boton.getAttribute && boton.getAttribute('data-hilvana-rechazo');
        if (pagina) irA(pagina);
      } catch (e) {}
    }

    function enganchar() {
      try {
        document.addEventListener('click', function (ev) {
          var el = ev.target;
          while (el && el !== document.body) {
            if (el.getAttribute && el.getAttribute('data-hilvana-upsell')) {
              aceptarUpsell(el.getAttribute('data-hilvana-upsell'));
              return;
            }
            el = el.parentElement;
          }
        });
      } catch (e) {}
    }

    // ── El botón de wallet: UN TOQUE, sin pasar por el cobro off-session ────
    //
    // Por qué existe: el cobro contra la tarjeta guardada
    // (\`POST /api/upsell/cobrar\`) está bloqueado del lado de Whop — devuelve un
    // 400 genérico sin decline_code, con seis hipótesis descartadas y medidas.
    // Este camino no lo usa: le pide una sesión al server y monta el botón de
    // Apple Pay / Google Pay de Whop. El comprador toca UNA vez, aprueba con
    // Face ID, y el wallet resuelve el pago y la autenticación del banco solo.
    //
    // Del lado del funnel es un div y nada más:
    //
    //     <div data-hilvana-wallet="mi-slug"></div>
    //
    // Todo lo demás —la sesión, el script de Whop, el custom element, la
    // confirmación y el redirect— lo hace este script. El funnel no necesita
    // saber que Whop existe, que es la misma razón por la que \`loader.js\`
    // existe en primer lugar.

    var scriptWhopPromesa = null;

    function cargarScriptWhop() {
      // El script de Whop registra el custom element <whop-express-checkout-button>.
      // Se carga UNA vez y bajo demanda: no se le agrega ~50 kB a cada página del
      // funnel para un botón que puede no estar en esa página.
      if (scriptWhopPromesa) return scriptWhopPromesa;
      scriptWhopPromesa = new Promise(function (resolve, reject) {
        try {
          var src = 'https://js.whop.com/static/checkout/loader.js';
          var existente = document.querySelector('script[src="' + src + '"]');
          if (existente) {
            if (window.customElements && window.customElements.get('whop-express-checkout-button')) {
              resolve();
              return;
            }
            existente.addEventListener('load', function () { resolve(); });
            existente.addEventListener('error', function () { reject(new Error('no cargó')); });
            return;
          }
          var s = document.createElement('script');
          s.src = src;
          s.async = true;
          s.onload = function () { resolve(); };
          s.onerror = function () { reject(new Error('no cargó')); };
          (document.head || document.body || document.documentElement).appendChild(s);
        } catch (e) {
          reject(e);
        }
      });
      return scriptWhopPromesa;
    }

    async function pedirSesion(slug) {
      var resp = await fetch(base() + '/api/upsell/sesion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token(), slug: slug }),
      });
      return await resp.json().catch(function () { return {}; });
    }

    // ── Caché de la sesión + el método del front, por slug ──────────────────
    //
    // "pedirSesion" crea una checkout configuration en Whop cada vez que se
    // llama: pedirla en el CLICK de aceptarUpsell (como se hacía) funciona,
    // pero le agrega al comprador un round-trip antes de saber qué botón
    // mostrarle — y si el front se pagó con wallet, ESE round-trip es
    // exactamente lo que rompe la cadena de gesto de usuario que el navegador
    // exige para abrir la hoja de Apple Pay/Google Pay (solo se puede abrir
    // como reacción DIRECTA a un click, sin ningún await en el medio).
    //
    // Por eso se precarga al cargar la página (precargarSesionUpsell, más
    // abajo), antes de que exista ningún click: cuando el comprador toca el
    // botón, aceptarUpsell ya tiene la sesión Y el metodoFront resueltos en
    // memoria, y puede decidir la rama sin ningún await previo.
    var sesionesPorSlug = {};

    async function sesionCacheada(slug) {
      if (sesionesPorSlug[slug]) return sesionesPorSlug[slug];
      var promesa = pedirSesion(slug).then(function (sesion) {
        // Se cuelga el resultado directo de la promesa (no es una API
        // estándar de Promise, es una propiedad propia) para que
        // aceptarUpsell pueda leerlo SIN await cuando ya se resolvió: es lo
        // que le permite decidir la rama de wallet dentro del mismo gesto de
        // click, sin esperar de nuevo a este fetch.
        promesa.hilvanaResuelta = sesion;
        return sesion;
      });
      sesionesPorSlug[slug] = promesa;
      return promesa;
    }

    /**
     * Precarga la sesión de todos los botones data-hilvana-upsell de la
     * página, apenas carga el script — no espera al click. Idempotente
     * (sesionCacheada no repite el fetch por slug), así que se puede llamar
     * de más sin costo. Si falla, aceptarUpsell simplemente vuelve a pedirla
     * en el momento del click (con el costo de latencia de siempre, pero sin
     * romper nada).
     */
    function precargarSesionesDeLaPagina() {
      try {
        var nodos = document.querySelectorAll('[data-hilvana-upsell]');
        for (var i = 0; i < nodos.length; i++) {
          var slug = nodos[i].getAttribute('data-hilvana-upsell');
          if (slug) void sesionCacheada(slug).catch(function () {});
        }
      } catch (e) {}
    }

    async function confirmar(slug, receiptId) {
      var resp = await fetch(base() + '/api/upsell/confirmar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token(), slug: slug, receiptId: receiptId }),
      });
      return await resp.json().catch(function () { return {}; });
    }

    /**
     * Le muestra al comprador que el pago falló, debajo del botón de wallet.
     *
     * ── Por qué el loader dibuja UI, si en general no lo hace ─────────────────
     * Todo lo demás de este script es invisible a propósito: el funnel es dueño de
     * su HTML y de su diseño. Pero un \`payment-error\` que solo va a la consola deja
     * a alguien mirando un botón que no respondió, sin saber si se cobró, si tiene
     * que reintentar, ni si perdió la oferta. Eso no es una decisión de diseño del
     * funnel: es información que solo este script tiene.
     *
     * Se mantiene deliberadamente mínimo: un párrafo, sin colores de marca, sin
     * fuentes propias, heredando el tamaño del contenedor. Si el funnel quiere algo
     * propio, puede estilar \`.hilvana-error-pago\`.
     *
     * \`role="alert"\` para que un lector de pantalla lo anuncie: el comprador ciego
     * es exactamente el que no puede darse cuenta solo de que el botón no hizo nada.
     */
    function mostrarErrorDePago(contenedor, mensaje, codigo) {
      try {
        if (!contenedor || !contenedor.parentNode) return;

        var texto = mensaje
          ? String(mensaje)
          : 'No se pudo completar el pago. Probá de nuevo o usá otro medio.';
        if (codigo) texto += ' (' + String(codigo) + ')';

        // Reusar el mismo nodo entre intentos: sin esto, tres fallas dejan tres
        // párrafos apilados empujando la página.
        var previo = contenedor.parentNode.querySelector('.hilvana-error-pago');
        if (previo) {
          previo.textContent = texto;
          return;
        }

        var p = document.createElement('p');
        p.className = 'hilvana-error-pago';
        p.setAttribute('role', 'alert');
        p.textContent = texto;
        p.style.margin = '8px 0 0';
        p.style.lineHeight = '1.4';
        // \`currentColor\` y no un rojo fijo: sobre el fondo oscuro de un funnel, un
        // #b91c1c queda ilegible. Hereda el color del texto de alrededor, que ya
        // está elegido para contrastar con ese fondo.
        p.style.color = 'currentColor';
        p.style.opacity = '0.9';
        contenedor.parentNode.insertBefore(p, contenedor.nextSibling);
      } catch (e) {
        // Si el DOM del funnel no deja insertar, no se rompe el cobro por el aviso.
        console.log('[hilvana] no se pudo mostrar el error de pago', e);
      }
    }

    async function montarWallet(contenedor) {
      var slug = contenedor.getAttribute('data-hilvana-wallet');
      if (!slug) return;
      // Marca para no montar dos veces el mismo contenedor: este arranque corre
      // en \`load\` y también lo puede llamar el funnel a mano.
      if (contenedor.getAttribute('data-hilvana-montado') === '1') return;
      contenedor.setAttribute('data-hilvana-montado', '1');

      if (!token()) {
        // Sin token no hay orden: alguien entró a la página del upsell por un
        // link directo. No es un error que haya que mostrar.
        console.log('[hilvana] wallet(' + slug + '): sin token, no se monta');
        return;
      }

      try {
        var sesion = await pedirSesion(slug);
        if (!sesion || !sesion.sessionId) {
          console.log('[hilvana] wallet(' + slug + '): sin sesión', sesion);
          return;
        }

        await cargarScriptWhop();

        var boton = document.createElement('whop-express-checkout-button');
        boton.setAttribute('checkout-configuration-id', sesion.sessionId);
        // Volver a ESTA página si el método necesita redirigir. Whop lo exige
        // aunque con el listener de 'complete' no se use en el camino feliz.
        boton.setAttribute('return-url', window.location.href);
        boton.setAttribute('theme', 'light');
        boton.setAttribute('skip-redirect', 'true');
        // Se pide guardar el método: si el cobro off-session se destraba algún
        // día, el paso siguiente ya queda habilitado sin tocar nada.
        boton.setAttribute('setup-future-usage', 'off_session');
        // El email de la compra del front. Los wallets lo traen del dispositivo,
        // pero Whop Pay —el caso de la tarjeta, y el que ve todo browser sin
        // wallet— lo pediría de nuevo. Es el único campo que quedaría por tipear
        // en un flujo que se vende como "un toque".
        if (sesion.email) boton.setAttribute('prefill-email', sesion.email);

        boton.addEventListener('express-method-resolved', function (ev) {
          var r = ev && ev.detail ? ev.detail.rendered : null;
          console.log('[hilvana] wallet(' + slug + '): método = ' + r);
          // Sin ningún wallet disponible se esconde el contenedor entero, para no
          // dejar un hueco. El botón normal (data-hilvana-upsell) sigue ahí.
          if (r === 'none') {
            try { contenedor.style.display = 'none'; } catch (e) {}
          }
        });

        boton.addEventListener('complete', async function (ev) {
          var recibo = ev && ev.detail ? (ev.detail.receiptOrSetupIntentId || ev.detail.receiptId) : null;
          if (!recibo) {
            console.log('[hilvana] wallet(' + slug + '): completó sin recibo', ev && ev.detail);
            return;
          }
          try {
            var res = await confirmar(slug, recibo);
            if (res && res.siguienteUrl) {
              irA(res.siguienteUrl);
              return;
            }
            // Pagó pero no hay a dónde ir: no se lo manda a ninguna parte y el
            // cron de reconciliación cierra el cobro. Peor sería un redirect a
            // una URL inventada.
            console.log('[hilvana] wallet(' + slug + '): confirmado sin siguiente URL', res);
          } catch (e) {
            console.log('[hilvana] wallet(' + slug + '): error confirmando', e);
          }
        });

        boton.addEventListener('payment-error', function (ev) {
          var detalle = ev && ev.detail ? ev.detail : {};
          console.log('[hilvana] wallet(' + slug + '): error de pago', detalle);
          // Mostrárselo al comprador, no solo a la consola. Un wallet que falla en
          // silencio deja a alguien mirando un botón que no responde, y lo que hace
          // es irse — no abrir las devtools.
          mostrarErrorDePago(contenedor, detalle.message, detalle.code);
        });

        contenedor.appendChild(boton);
      } catch (e) {
        console.log('[hilvana] wallet(' + slug + '): no se pudo montar', e);
      }
    }

    function montarTodosLosWallets() {
      try {
        var nodos = document.querySelectorAll('[data-hilvana-wallet]');
        for (var i = 0; i < nodos.length; i++) montarWallet(nodos[i]);
      } catch (e) {}
    }

    // ── data-hilvana-delay: el botón aparece recién a los N segundos ────────
    //
    // Pensado para debajo de un VSL, en un punto fijo del video, sin que el
    // operador del funnel tenga que escribir ningún JS: el número lo elige en
    // el editor del paso, el panel lo interpola en el snippet que se copia
    // (ver lib/admin/integracion.ts), y esto es lo único que lo interpreta —
    // le da igual si el atributo vino del generador o si alguien lo escribió
    // a mano.
    //
    // Se opera sobre el elemento MARCADO (el div de wallet, o el botón mismo
    // de data-hilvana-upsell), no sobre un contenedor externo: así funciona
    // igual sea cual sea el HTML que el operador puso alrededor.
    //
    // "visibility: hidden" y no "display: none": con display:none el elemento
    // no ocupa espacio y todo lo que esté debajo salta hacia arriba cuando el
    // botón aparece — un salto de layout justo en el momento de decisión es
    // peor que un espacio vacío por unos segundos. Se fija la altura ANTES de
    // ocultarlo, por si el navegador colapsara igual una caja vacía con solo
    // visibility:hidden en algún layout (flex/grid con altura automática
    // puede hacerlo).
    function aplicarDelays() {
      try {
        var nodos = document.querySelectorAll('[data-hilvana-delay]');
        for (var i = 0; i < nodos.length; i++) {
          (function (el) {
            var seg = parseFloat(el.getAttribute('data-hilvana-delay'));
            if (!isFinite(seg) || seg <= 0) return;
            if (el.getAttribute('data-hilvana-delay-armado')) return; // no reprocesar
            el.setAttribute('data-hilvana-delay-armado', '1');

            var alto = el.offsetHeight;
            if (alto > 0) el.style.minHeight = alto + 'px';
            el.style.visibility = 'hidden';

            setTimeout(function () {
              el.style.visibility = '';
              el.style.minHeight = '';
            }, seg * 1000);
          })(nodos[i]);
        }
      } catch (e) {}
    }

    // Al cargar: si vino ?ot= en la URL, se guarda. Si no, se usa el que ya
    // hubiera en sessionStorage. token() ya hace las dos cosas por su cuenta,
    // pero se llama una vez ahora para que quede guardado ni bien carga el
    // script, sin esperar al primer click.
    token();
    enganchar();
    // Sin token no hay orden que consultar — no tiene sentido pedir la sesión
    // de un upsell para un comprador que llegó sin haber pagado el front.
    if (token()) precargarSesionesDeLaPagina();

    // Los wallets se montan cuando el DOM está listo: el bloque de oferta de un
    // funnel con VSL suele aparecer más tarde, así que además se reintenta en
    // 'load' y se deja la función expuesta para que el funnel la llame cuando
    // revele su bloque. montarWallet marca el contenedor, así que llamarla de
    // más no duplica botones.
    try {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', montarTodosLosWallets);
        document.addEventListener('DOMContentLoaded', aplicarDelays);
        if (token()) document.addEventListener('DOMContentLoaded', precargarSesionesDeLaPagina);
      } else {
        montarTodosLosWallets();
        aplicarDelays();
        if (token()) precargarSesionesDeLaPagina();
      }
      window.addEventListener('load', montarTodosLosWallets);
      window.addEventListener('load', aplicarDelays);
      if (token()) window.addEventListener('load', precargarSesionesDeLaPagina);
    } catch (e) {}

    window.hilvana = {
      aceptarUpsell: aceptarUpsell,
      rechazarUpsell: rechazarUpsell,
      token: token,
      /**
       * Para el funnel que revela su bloque de oferta después de cargar (un VSL,
       * por ejemplo): llamala cuando el div con data-hilvana-wallet entre al
       * DOM. Es idempotente.
       */
      montarWallets: montarTodosLosWallets,
      /**
       * Igual idea que montarWallets, para el atributo data-hilvana-delay: si
       * el funnel inserta el bloque con el botón DESPUÉS de que este script ya
       * corrió, llamala una vez insertado. Es idempotente (marca cada nodo con
       * data-hilvana-delay-armado la primera vez que lo procesa).
       */
      aplicarDelays: aplicarDelays,
      /**
       * Igual idea, para data-hilvana-upsell: si el botón del upsell se
       * inserta DESPUÉS de que este script corrió, llamala una vez insertado
       * — sin esto, ese botón no tiene la sesión precargada y aceptarUpsell
       * cae al camino normal (pide la sesión en el momento, con el costo de
       * latencia de siempre, pero sin romper nada). Es idempotente
       * (sesionCacheada no repite el fetch por slug).
       */
      precargarSesionesDeUpsell: precargarSesionesDeLaPagina,
    };
  } catch (e) {
    // Ni esto puede tirar hacia afuera. Si algo de lo de arriba falló de una
    // forma que no se previó, window.hilvana simplemente no existe, y un
    // funnel que lo llame sin chequear va a ver un TypeError contenido en su
    // propio try/catch (si lo tiene) — pero nunca un error que salga de este
    // script hacia el resto de la página.
    try { console.log('[hilvana] error inicializando', e); } catch (e2) {}
  }
})();
`.trim();

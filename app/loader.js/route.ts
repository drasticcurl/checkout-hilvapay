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

    function deshabilitar(boton, texto) {
      try {
        if (boton && boton.setAttribute) {
          boton.setAttribute('disabled', 'disabled');
          if (texto) boton.textContent = texto;
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
      deshabilitar(boton, 'Procesando...');

      try {
        var resultado = await cobrar(slug);

        if (resultado && resultado.error === 'sin_metodo_guardado') {
          irA(base() + '/pagos/' + encodeURIComponent(slug) + '?ot=' + encodeURIComponent(t) + '&r=1');
          return;
        }

        if (!resultado || !resultado.cobroId) {
          console.log('[hilvana] aceptarUpsell(' + slug + '): respuesta inesperada', resultado);
          deshabilitar(boton, null);
          if (boton) boton.removeAttribute('disabled');
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
        deshabilitar(boton, null);
        if (boton) boton.removeAttribute('disabled');
      } catch (e) {
        console.log('[hilvana] aceptarUpsell(' + slug + '): error de red', e);
        if (boton) boton.removeAttribute('disabled');
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

    // Al cargar: si vino ?ot= en la URL, se guarda. Si no, se usa el que ya
    // hubiera en sessionStorage. token() ya hace las dos cosas por su cuenta,
    // pero se llama una vez ahora para que quede guardado ni bien carga el
    // script, sin esperar al primer click.
    token();
    enganchar();

    window.hilvana = {
      aceptarUpsell: aceptarUpsell,
      rechazarUpsell: rechazarUpsell,
      token: token,
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

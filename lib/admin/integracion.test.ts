/**
 * Tests de `lib/admin/integracion.ts`.
 *
 * Lo que se prueba acá no es "la función devuelve un string": es el string
 * EXACTO que el usuario va a copiar y pegar en el repo de un funnel que factura.
 * Un `data-hilvana-upsel` con una L, un slug del paso equivocado o una barra
 * doble en la URL del loader no fallan en ningún test genérico y sí cobran mal
 * en producción. Por eso las aserciones son sobre el texto completo.
 */
import { describe, it, expect } from 'vitest';
import {
  baseEsAbsoluta,
  destinosDeRechazo,
  formatearPrecio,
  integracionDeFunnel,
  integracionDesdeFunnel,
  normalizarBase,
  origenDeUrl,
  snippetBotonHtml,
  snippetBotonJsx,
  snippetLoader,
  snippetRechazo,
  urlConOfertaInmediata,
  type PasoParaSnippet,
} from './integracion';

const BASE = 'https://pay.hilvanapp.com';

function paso(over: Partial<PasoParaSnippet> = {}): PasoParaSnippet {
  return {
    slug: 'upsell1-latam',
    tipo: 'upsell',
    nombre: 'Upsell 1',
    url_externa: 'https://funnel.com/upsell-latam',
    permite_rechazo: false,
    producto: { nombre: 'Programa TURBO', precio: '19.90', moneda: 'usd' },
    delay_segundos: null,
    ...over,
  };
}

describe('normalizarBase', () => {
  it('saca la barra final para que el snippet no salga con //loader.js', () => {
    expect(normalizarBase('https://pay.hilvanapp.com/')).toBe('https://pay.hilvanapp.com');
  });

  it('saca varias barras finales y espacios, que es como llega de un .env escrito a mano', () => {
    expect(normalizarBase('  https://pay.hilvanapp.com///  ')).toBe('https://pay.hilvanapp.com');
  });

  it('deja intacta una base ya normalizada', () => {
    expect(normalizarBase(BASE)).toBe(BASE);
  });
});

describe('origenDeUrl', () => {
  it('devuelve solo el origen, que es lo que el browser manda en el header Origin', () => {
    // Es el punto: pegar la URL entera en la allowlist no matchea nunca, porque
    // el header Origin no lleva path.
    expect(origenDeUrl('https://funnel.com/upsell-latam?x=1')).toBe('https://funnel.com');
  });

  it('conserva el puerto, porque el Origin de un dev server lo lleva', () => {
    expect(origenDeUrl('http://localhost:3000/upsell-latam')).toBe('http://localhost:3000');
  });

  it('devuelve null en una URL inválida en vez de tirar', () => {
    expect(origenDeUrl('no soy una url')).toBeNull();
  });
});

describe('urlConOfertaInmediata', () => {
  it('agrega ?offer=now cuando la URL no tiene querystring', () => {
    expect(urlConOfertaInmediata('https://funnel.com/upsell-latam')).toBe(
      'https://funnel.com/upsell-latam?offer=now',
    );
  });

  it('agrega &offer=now respetando el querystring existente', () => {
    // Con concatenación a mano esto daría `?utm_source=fb?offer=now`: un solo
    // param ilegible, y el funnel nunca revela la oferta.
    expect(urlConOfertaInmediata('https://funnel.com/upsell-latam?utm_source=fb')).toBe(
      'https://funnel.com/upsell-latam?utm_source=fb&offer=now',
    );
  });

  it('no duplica offer si ya estaba', () => {
    expect(urlConOfertaInmediata('https://funnel.com/upsell-latam?offer=now')).toBe(
      'https://funnel.com/upsell-latam?offer=now',
    );
  });

  it('devuelve null en una URL inválida', () => {
    expect(urlConOfertaInmediata('/upsell-latam')).toBeNull();
  });

  /**
   * La afirmación que hace que `?offer=now` sirva para testear el cobro y no
   * solo el diseño: el checkout agrega `ot` con `searchParams.set` (ver
   * `resolverSiguienteUrl` en lib/funnels.ts y `armarUrlConToken` en
   * components/checkout/utils.ts), así que los dos parámetros conviven.
   *
   * Si algún día alguien "simplifica" cualquiera de los dos a una concatenación
   * con `?`, este test se cae y explica qué se rompió: poner `offer=now` en la
   * `url_externa` del paso deja de funcionar.
   */
  it('sobrevive al agregado de ?ot= que hace el checkout al redirigir', () => {
    const configuradaEnElPanel = urlConOfertaInmediata('https://funnel.com/upsell-latam');
    expect(configuradaEnElPanel).not.toBeNull();

    // Exactamente lo que hace resolverSiguienteUrl con el token de la orden.
    const conToken = new URL(configuradaEnElPanel as string);
    conToken.searchParams.set('ot', 'TOKEN123');

    expect(conToken.toString()).toBe('https://funnel.com/upsell-latam?offer=now&ot=TOKEN123');
    expect(conToken.searchParams.get('offer')).toBe('now');
    expect(conToken.searchParams.get('ot')).toBe('TOKEN123');
  });
});

describe('formatearPrecio', () => {
  it('usa US$ y coma decimal', () => {
    expect(formatearPrecio('19.90', 'usd')).toBe('US$ 19,90');
  });

  it('mantiene los dos decimales de numeric(10,2): 9.9 no puede salir como 9,9', () => {
    // pg devuelve numeric como string; un '9.9' mostrado como "US$ 9,9" rompe la
    // promesa de precio de la landing.
    expect(formatearPrecio('9.9', 'usd')).toBe('US$ 9,90');
  });

  it('con otra moneda usa el código en mayúsculas', () => {
    expect(formatearPrecio('1500.00', 'ars')).toBe('ARS 1500,00');
  });
});

describe('snippetLoader', () => {
  it('genera el script sin defer ni async', () => {
    // Sin defer a propósito: el listener de click tiene que existir antes de que
    // la página sea clickeable. Ver el comentario de la función.
    expect(snippetLoader(BASE)).toBe('<script src="https://pay.hilvanapp.com/loader.js"></script>');
  });

  it('no deja doble barra si la base viene con barra final', () => {
    expect(snippetLoader('https://pay.hilvanapp.com/')).toBe(
      '<script src="https://pay.hilvanapp.com/loader.js"></script>',
    );
  });
});

describe('snippetBotonHtml', () => {
  it('lleva el slug del paso en data-hilvana-upsell y type=button', () => {
    const html = snippetBotonHtml(paso(), 'US$ 19,90');
    expect(html).toBe(
      '<button type="button" data-hilvana-upsell="upsell1-latam">\n  Sí, quiero — US$ 19,90\n</button>',
    );
  });

  it('el atributo se escribe exactamente como lo busca el loader', () => {
    // El loader hace querySelector('[data-hilvana-upsell="' + slug + '"]'). Una
    // sola letra distinta acá y el botón no cobra nunca, sin ningún error.
    const html = snippetBotonHtml(paso({ slug: 'otro-slug' }), 'US$ 1,00');
    expect(html).toContain('data-hilvana-upsell="otro-slug"');
    expect(html).not.toContain('data-hilvana-upsel="');
  });

  it('sin delay configurado, no agrega data-hilvana-delay (el caso normal, sin cambios)', () => {
    const html = snippetBotonHtml(paso({ delay_segundos: null }), 'US$ 19,90');
    expect(html).not.toContain('data-hilvana-delay');
  });

  it('con delay configurado, lo interpola en el mismo elemento del botón', () => {
    const html = snippetBotonHtml(paso({ delay_segundos: 12 }), 'US$ 19,90');
    expect(html).toBe(
      '<button type="button" data-hilvana-upsell="upsell1-latam" data-hilvana-delay="12">\n  Sí, quiero — US$ 19,90\n</button>',
    );
  });
});

describe('snippetBotonJsx', () => {
  it('usa className y no class, y no lleva onClick', () => {
    const jsx = snippetBotonJsx(paso(), 'US$ 19,90');
    expect(jsx).toContain('className=');
    expect(jsx).not.toContain(' class=');
    // Con KashPay hacía falta un onClick porque su onclick literal lo ignoraba
    // React. Acá el atributo data-* lo lee el listener global.
    expect(jsx).not.toContain('onClick');
    expect(jsx).toContain('data-hilvana-upsell="upsell1-latam"');
  });

  it('con delay configurado, lo interpola en su propia línea', () => {
    const jsx = snippetBotonJsx(paso({ delay_segundos: 12 }), 'US$ 19,90');
    expect(jsx).toContain('data-hilvana-delay="12"');
  });
});

describe('snippetRechazo', () => {
  it('es un <a href> al destino que decidió el panel', () => {
    expect(snippetRechazo('https://funnel.com/downsell-latam')).toBe(
      '<a href="https://funnel.com/downsell-latam">No, gracias</a>',
    );
  });

  it('sin destino cae a un placeholder visible, no a un href vacío', () => {
    // Un href="" recarga la página actual: es peor que un placeholder que se ve
    // mal y se corrige.
    expect(snippetRechazo(null)).toBe('<a href="/downsell">No, gracias</a>');
  });
});

describe('baseEsAbsoluta', () => {
  it('acepta http y https', () => {
    expect(baseEsAbsoluta('https://pay.hilvanapp.com')).toBe(true);
    expect(baseEsAbsoluta('http://localhost:3020')).toBe(true);
  });

  it('rechaza la base vacía, que es el caso que produce el snippet roto', () => {
    // Con base vacía el snippet sale `<script src="/loader.js">`: relativo al
    // dominio del funnel, 404, y los botones no cobran sin ningún error.
    expect(baseEsAbsoluta('')).toBe(false);
    expect(baseEsAbsoluta('   ')).toBe(false);
  });

  it('rechaza una ruta relativa y un host sin esquema', () => {
    expect(baseEsAbsoluta('/loader')).toBe(false);
    expect(baseEsAbsoluta('pay.hilvanapp.com')).toBe(false);
  });

  it('rechaza un esquema que no sirve para el src de un script', () => {
    expect(baseEsAbsoluta('ftp://pay.hilvanapp.com')).toBe(false);
  });
});

describe('integracionDeFunnel', () => {
  it('marca baseConfigurada según la base recibida', () => {
    expect(integracionDeFunnel(BASE, [paso()]).baseConfigurada).toBe(true);
    expect(integracionDeFunnel('', [paso()]).baseConfigurada).toBe(false);
  });

  it('no genera botón para el paso front: su checkout es de este lado', () => {
    const r = integracionDeFunnel(BASE, [
      paso({ slug: 'aguadearroz1', tipo: 'front', url_externa: null }),
      paso({ slug: 'upsell1-latam' }),
    ]);
    expect(r.pasos).toHaveLength(1);
    expect(r.pasos[0].slug).toBe('upsell1-latam');
  });

  it('deriva los orígenes a autorizar de las url_externa, sin duplicados y ordenados', () => {
    const r = integracionDeFunnel(BASE, [
      paso({ slug: 'u1', url_externa: 'https://funnel.com/upsell-latam' }),
      paso({ slug: 'u2', url_externa: 'https://funnel.com/upsell2-latam' }),
      paso({ slug: 'u3', url_externa: 'https://otro.com/oferta' }),
    ]);
    expect(r.origenesNecesarios).toEqual(['https://funnel.com', 'https://otro.com']);
  });

  it('marca incompleto el paso sin url_externa y no le inventa una URL de prueba', () => {
    const r = integracionDeFunnel(BASE, [paso({ url_externa: null })]);
    expect(r.pasos[0].incompleto).toBe(true);
    expect(r.pasos[0].urlDePrueba).toBeNull();
  });

  it('da la URL de prueba con offer=now del paso configurado', () => {
    const r = integracionDeFunnel(BASE, [paso()]);
    expect(r.pasos[0].incompleto).toBe(false);
    expect(r.pasos[0].urlDePrueba).toBe('https://funnel.com/upsell-latam?offer=now');
  });

  it('incluye el link de rechazo solo cuando el paso lo permite', () => {
    const sin = integracionDeFunnel(BASE, [paso({ permite_rechazo: false })]);
    expect(sin.pasos[0].html).not.toContain('No, gracias');

    const con = integracionDeFunnel(
      BASE,
      [paso({ permite_rechazo: true })],
      { 'upsell1-latam': 'https://funnel.com/downsell-latam' },
    );
    expect(con.pasos[0].html).toContain('<a href="https://funnel.com/downsell-latam">No, gracias</a>');
  });

  it('titula el paso con su nombre interno, y cae al del producto si falta', () => {
    const conNombre = integracionDeFunnel(BASE, [paso({ nombre: 'Upsell 1' })]);
    expect(conNombre.pasos[0].titulo).toBe('Upsell 1');

    const sinNombre = integracionDeFunnel(BASE, [paso({ nombre: null })]);
    expect(sinNombre.pasos[0].titulo).toBe('Programa TURBO');
  });

  it('un funnel sin upsells da la lista de pasos vacía pero igual el loader', () => {
    // El loader se pega igual: guarda el ?ot= para cuando se agregue un upsell.
    const r = integracionDeFunnel(BASE, [paso({ tipo: 'front', url_externa: null })]);
    expect(r.pasos).toEqual([]);
    expect(r.loader).toContain('/loader.js');
    expect(r.urlLoader).toBe('https://pay.hilvanapp.com/loader.js');
  });

  it('el snippet de Next usa beforeInteractive, la única estrategia que corre antes de hidratar', () => {
    const r = integracionDeFunnel(BASE, [paso()]);
    expect(r.loaderNext).toContain('strategy="beforeInteractive"');
    expect(r.loaderNext).toContain('https://pay.hilvanapp.com/loader.js');
  });
});

describe('destinosDeRechazo', () => {
  const u1 = {
    ...paso({ slug: 'upsell1', url_externa: 'https://funnel.com/upsell-latam', permite_rechazo: true }),
    id: 'id-u1',
    paso_rechazado_id: 'id-down1',
  };
  const down1 = {
    ...paso({ slug: 'downsell1', url_externa: 'https://funnel.com/downsell-latam' }),
    id: 'id-down1',
    paso_rechazado_id: null,
  };

  it('resuelve la URL del paso APUNTADO, no la del paso actual', () => {
    // Leer la del paso actual mandaría el "no gracias" a la misma oferta que se
    // acaba de rechazar: un bucle sin salida a la página de gracias.
    expect(destinosDeRechazo([u1, down1])).toEqual({ upsell1: 'https://funnel.com/downsell-latam' });
  });

  it('ignora los pasos que no permiten rechazo', () => {
    const sinRechazo = { ...u1, permite_rechazo: false };
    expect(destinosDeRechazo([sinRechazo, down1])).toEqual({});
  });

  it('deja el destino en null si la flecha apunta a un paso que ya no está', () => {
    // `on delete set null` de la migración 003 puede dejar esto colgado; el
    // snippet cae al placeholder en vez de a un href vacío.
    expect(destinosDeRechazo([u1])).toEqual({ upsell1: null });
  });

  it('integracionDesdeFunnel arma el href del rechazo sin segundo argumento', () => {
    const r = integracionDesdeFunnel(BASE, [u1, down1]);
    const upsell = r.pasos.find((p) => p.slug === 'upsell1');
    expect(upsell?.html).toContain('<a href="https://funnel.com/downsell-latam">No, gracias</a>');
  });
});

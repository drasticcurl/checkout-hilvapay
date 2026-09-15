import { describe, expect, it } from 'vitest';
import {
  detectarCiclo,
  resolverDestino,
  resolverDestinoPorFondos,
  resultadoDeEstado,
  type FunnelParaResolver,
  type PasoParaResolver,
} from './funnels';

const FUNNEL: FunnelParaResolver = { id: 'f1', activo: true, url_gracias: 'https://f.com/gracias' };

function paso(over: Partial<PasoParaResolver> = {}): PasoParaResolver {
  return {
    id: 'p1',
    funnel_id: 'f1',
    permite_rechazo: false,
    paso_aceptado_id: null,
    paso_rechazado_id: null,
    downsell_por_fondos_id: null,
    url_exito: null,
    url_rechazo: null,
    ...over,
  };
}

const URLS = {
  p2: 'https://f.com/upsell-1',
  p3: 'https://f.com/upsell-2',
  sinUrl: null,
};

describe('resolverDestino — camino aceptado', () => {
  it('manda a la url_externa DEL PASO DESTINO, no del actual', () => {
    // Es el corazón del modelo: el paso actual no sabe su propia URL de salida,
    // sabe a qué paso va. Si esto se invirtiera, reordenar el funnel obligaría a
    // reescribir las URLs de todos los pasos anteriores.
    const d = resolverDestino(paso({ paso_aceptado_id: 'p2' }), 'aceptado', FUNNEL, URLS);
    expect(d).toEqual({ tipo: 'paso', pasoId: 'p2', url: 'https://f.com/upsell-1' });
  });

  it('sin siguiente, va a la página de gracias', () => {
    const d = resolverDestino(paso(), 'aceptado', FUNNEL, URLS);
    expect(d).toEqual({ tipo: 'gracias', url: 'https://f.com/gracias' });
  });

  it('si el paso destino no tiene url_externa, cae a gracias y no deja al comprador en el aire', () => {
    // Ya le cobraste. Un campo vacío del panel no puede terminar en una pantalla
    // muerta.
    const d = resolverDestino(paso({ paso_aceptado_id: 'sinUrl' }), 'aceptado', FUNNEL, URLS);
    expect(d).toEqual({ tipo: 'gracias', url: 'https://f.com/gracias' });
  });

  it('sin url_externa y sin gracias, lo dice explícitamente', () => {
    const sinGracias = { ...FUNNEL, url_gracias: null };
    const d = resolverDestino(paso({ paso_aceptado_id: 'sinUrl' }), 'aceptado', sinGracias, URLS);
    expect(d.tipo).toBe('sin_destino');
  });
});

describe('resolverDestino — camino rechazado', () => {
  it('con el botón de rechazo APAGADO no hay destino, aunque haya paso configurado', () => {
    // El toggle es la decisión del panel de no ofrecer salida sin comprar. Si el
    // rechazo funcionara igual, sería una puerta que el panel dijo que no quería.
    const d = resolverDestino(
      paso({ permite_rechazo: false, paso_rechazado_id: 'p3' }),
      'rechazado',
      FUNNEL,
      URLS,
    );
    expect(d.tipo).toBe('sin_destino');
  });

  it('con el botón encendido va al downsell configurado', () => {
    const d = resolverDestino(
      paso({ permite_rechazo: true, paso_rechazado_id: 'p3' }),
      'rechazado',
      FUNNEL,
      URLS,
    );
    expect(d).toEqual({ tipo: 'paso', pasoId: 'p3', url: 'https://f.com/upsell-2' });
  });

  it('con el botón encendido y sin downsell, va a gracias', () => {
    const d = resolverDestino(paso({ permite_rechazo: true }), 'rechazado', FUNNEL, URLS);
    expect(d).toEqual({ tipo: 'gracias', url: 'https://f.com/gracias' });
  });

  it('el rechazo NO usa el paso del camino aceptado', () => {
    // Cruzar las dos ramas le cobraría al que dijo que no… bueno, no le cobraría,
    // pero le mostraría la oferta que aceptó quien sí compró. Es el bug de
    // confundir las flechas y no daría ningún error.
    const d = resolverDestino(
      paso({ permite_rechazo: true, paso_aceptado_id: 'p2', paso_rechazado_id: 'p3' }),
      'rechazado',
      FUNNEL,
      URLS,
    );
    expect(d).toMatchObject({ pasoId: 'p3' });
  });
});

describe('resolverDestinoPorFondos — migración 014, independiente de permite_rechazo', () => {
  it('con downsell configurado, va ahí — AUNQUE permite_rechazo esté apagado', () => {
    // Este es el caso que motivó la migración: fondos insuficientes no es un
    // click del comprador en el botón de rechazo, es Whop devolviendo un
    // decline. Exigir permite_rechazo obligaría a prender un botón visible que
    // el operador no quiere mostrar, solo para habilitar este otro camino.
    const d = resolverDestinoPorFondos(
      paso({ permite_rechazo: false, downsell_por_fondos_id: 'p3' }),
      FUNNEL,
      URLS,
    );
    expect(d).toEqual({ tipo: 'paso', pasoId: 'p3', url: 'https://f.com/upsell-2' });
  });

  it('sin downsell configurado (el caso default), sin destino — nunca cae a gracias', () => {
    // A diferencia de resolverDestino('rechazado'): mandar a la página de
    // gracias a alguien que NO compró este downsell sería mentirle. El
    // silencio (quedarse donde está) es lo correcto, igual que el
    // comportamiento de antes de esta migración.
    const d = resolverDestinoPorFondos(paso({ downsell_por_fondos_id: null }), FUNNEL, URLS);
    expect(d.tipo).toBe('sin_destino');
  });

  it('sin funnel (página suelta), sin destino — el downsell por fondos es un concepto de funnel', () => {
    const suelta = paso({ funnel_id: null, downsell_por_fondos_id: 'p3' });
    expect(resolverDestinoPorFondos(suelta, null, URLS).tipo).toBe('sin_destino');
  });

  it('el destino configurado pero sin url_externa: sin destino, NO cae a gracias', () => {
    // Distinto de resolverDestino, que en este caso SÍ cae a gracias (el
    // comprador ya pagó ese paso). Acá el comprador no compró el downsell, así
    // que gracias sería un mensaje falso — mejor no ir a ningún lado.
    const d = resolverDestinoPorFondos(paso({ downsell_por_fondos_id: 'sinUrl' }), FUNNEL, URLS);
    expect(d.tipo).toBe('sin_destino');
  });

  it('no usa paso_rechazado_id ni paso_aceptado_id: son caminos totalmente separados', () => {
    const d = resolverDestinoPorFondos(
      paso({ paso_aceptado_id: 'p2', paso_rechazado_id: 'p2', downsell_por_fondos_id: 'p3' }),
      FUNNEL,
      URLS,
    );
    expect(d).toMatchObject({ pasoId: 'p3' });
  });
});

describe('resolverDestino — páginas sueltas, sin funnel', () => {
  it('usa url_exito cuando no pertenece a un funnel', () => {
    // Compatibilidad: un link publicado en un anuncio antes de que existieran los
    // funnels no puede dejar de funcionar por la migración.
    const suelta = paso({ funnel_id: null, url_exito: 'https://viejo.com/next' });
    expect(resolverDestino(suelta, 'aceptado', null, {})).toEqual({
      tipo: 'url_directa',
      url: 'https://viejo.com/next',
    });
  });

  it('usa url_rechazo sin mirar permite_rechazo', () => {
    // El toggle es un concepto de funnel; una página suelta no lo tiene.
    const suelta = paso({ funnel_id: null, url_rechazo: 'https://viejo.com/no', permite_rechazo: false });
    expect(resolverDestino(suelta, 'rechazado', null, {})).toEqual({
      tipo: 'url_directa',
      url: 'https://viejo.com/no',
    });
  });

  it('sin funnel y sin URL, sin destino', () => {
    expect(resolverDestino(paso({ funnel_id: null }), 'aceptado', null, {}).tipo).toBe('sin_destino');
  });

  it('con funnel_id pero sin el funnel cargado, cae al modo suelto', () => {
    // Defensa contra un funnel borrado: la FK es `on delete set null`, pero si
    // alguna query no trae el join, mejor usar la URL vieja que no ir a ningún lado.
    const d = resolverDestino(paso({ url_exito: 'https://x.com/a' }), 'aceptado', null, {});
    expect(d).toEqual({ tipo: 'url_directa', url: 'https://x.com/a' });
  });
});

describe('resultadoDeEstado', () => {
  it('pagado es aceptado y fallido es rechazado', () => {
    expect(resultadoDeEstado('pagado')).toBe('aceptado');
    expect(resultadoDeEstado('fallido')).toBe('rechazado');
  });

  it('requiere_tarjeta NO es un rechazo', () => {
    // El comprador quiso pagar y el banco pidió autenticación. Sacarlo del funnel
    // ahí es perderlo en el momento en que más cerca estuvo de comprar.
    expect(resultadoDeEstado('requiere_tarjeta')).toBeNull();
  });

  it('procesando y creando no deciden nada', () => {
    expect(resultadoDeEstado('procesando')).toBeNull();
    expect(resultadoDeEstado('creando')).toBeNull();
  });
});

describe('detectarCiclo', () => {
  const p = (id: string, ac: string | null = null, re: string | null = null) => ({
    id,
    paso_aceptado_id: ac,
    paso_rechazado_id: re,
  });

  it('una cadena lineal no tiene ciclo', () => {
    expect(detectarCiclo([p('a', 'b'), p('b', 'c'), p('c')])).toBeNull();
  });

  it('detecta un ciclo de dos', () => {
    expect(detectarCiclo([p('a', 'b'), p('b', 'a')])).not.toBeNull();
  });

  it('detecta un ciclo de tres', () => {
    expect(detectarCiclo([p('a', 'b'), p('b', 'c'), p('c', 'a')])).not.toBeNull();
  });

  it('detecta un ciclo por la rama de rechazo', () => {
    expect(detectarCiclo([p('a', 'b'), p('b', null, 'a')])).not.toBeNull();
  });

  it('dos ramas que reconvergen NO son un ciclo', () => {
    // Es un caso legítimo y hay que permitirlo: aceptar y rechazar el upsell 1
    // pueden llevar los dos al upsell 2.
    expect(detectarCiclo([p('a', 'b', 'c'), p('b', 'd'), p('c', 'd'), p('d')])).toBeNull();
  });

  it('un puntero a un paso que no está en la lista no rompe', () => {
    // Pasa cuando un paso se borró: la FK lo deja en null, pero si la lista viene
    // de otra query, el id puede quedar apuntando a la nada.
    expect(detectarCiclo([p('a', 'no-existe')])).toBeNull();
  });

  it('el grafo vacío no tiene ciclo', () => {
    expect(detectarCiclo([])).toBeNull();
  });
});

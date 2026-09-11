import { describe, expect, it } from 'vitest';
import { pasoSiguiente, pasosConEstado, pasosTutorial, progreso, type SnapshotTutorial } from './tutorial';

/** Snapshot con todo en cero/false: el estado de un deploy recién hecho. */
const VACIO: SnapshotTutorial = {
  credencialesVerificadas: false,
  webhookRecibioAlgunEvento: false,
  productosConPlan: 0,
  hayFunnelConFrontYUpsell: false,
  origenesActivos: 0,
  funnelsActivos: 0,
  cobrosPagados: 0,
};

/** Snapshot con los 9 pasos completos: el estado "ya está todo cobrando". */
const COMPLETO: SnapshotTutorial = {
  credencialesVerificadas: true,
  webhookRecibioAlgunEvento: true,
  productosConPlan: 2,
  hayFunnelConFrontYUpsell: true,
  origenesActivos: 1,
  funnelsActivos: 1,
  cobrosPagados: 3,
};

describe('pasosTutorial', () => {
  it('devuelve 9 pasos, en el orden del flujo real', () => {
    const pasos = pasosTutorial(VACIO);
    expect(pasos).toHaveLength(9);
    expect(pasos.map((p) => p.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('con el snapshot vacío, ningún paso está hecho', () => {
    const pasos = pasosTutorial(VACIO);
    expect(pasos.every((p) => !p.hecho)).toBe(true);
  });

  it('con el snapshot completo, los 9 pasos están hechos', () => {
    const pasos = pasosTutorial(COMPLETO);
    expect(pasos.every((p) => p.hecho)).toBe(true);
  });

  it('cada paso tiene un href a la pantalla real donde se resuelve', () => {
    const pasos = pasosTutorial(VACIO);
    for (const p of pasos) {
      expect(p.href.startsWith('/admin')).toBe(true);
    }
  });

  it('el paso 1 (conectar Whop) depende solo de credencialesVerificadas', () => {
    const conCredenciales = pasosTutorial({ ...VACIO, credencialesVerificadas: true });
    expect(conCredenciales[0].hecho).toBe(true);
    expect(conCredenciales[0].numero).toBe(1);
  });

  it('el paso 2 (webhook) depende de que llegó algún evento', () => {
    const sinEventos = pasosTutorial(VACIO);
    expect(sinEventos[1].hecho).toBe(false);

    const conEventos = pasosTutorial({ ...VACIO, webhookRecibioAlgunEvento: true });
    expect(conEventos[1].hecho).toBe(true);
  });

  it('los pasos 3 (planes) y 4 (productos) están atados a la misma señal: productosConPlan', () => {
    // No hay forma de verificar desde la base si el plan existe en Whop sin
    // haberlo cargado como producto: cargar un producto CON whop_plan_id ya
    // implica que el plan existe del otro lado. Por eso comparten señal.
    const sinProductos = pasosTutorial(VACIO);
    expect(sinProductos[2].hecho).toBe(false);
    expect(sinProductos[3].hecho).toBe(false);

    const conProductos = pasosTutorial({ ...VACIO, productosConPlan: 1 });
    expect(conProductos[2].hecho).toBe(true);
    expect(conProductos[3].hecho).toBe(true);
  });

  it('el paso 5 (armar el funnel) exige front Y upsell juntos, no cualquiera', () => {
    const sinFunnel = pasosTutorial(VACIO);
    expect(sinFunnel[4].hecho).toBe(false);

    const conFunnelCompleto = pasosTutorial({ ...VACIO, hayFunnelConFrontYUpsell: true });
    expect(conFunnelCompleto[4].hecho).toBe(true);
  });

  it('el paso 6 (orígenes) depende de que haya al menos uno activo', () => {
    const sinOrigenes = pasosTutorial(VACIO);
    expect(sinOrigenes[5].hecho).toBe(false);

    const conOrigen = pasosTutorial({ ...VACIO, origenesActivos: 1 });
    expect(conOrigen[5].hecho).toBe(true);
  });

  it('el paso 8 (encender) exige funnel activo Y origen activo, no uno solo', () => {
    const soloFunnel = pasosTutorial({ ...VACIO, funnelsActivos: 1, origenesActivos: 0 });
    expect(soloFunnel[7].hecho).toBe(false);

    const soloOrigen = pasosTutorial({ ...VACIO, funnelsActivos: 0, origenesActivos: 1 });
    expect(soloOrigen[7].hecho).toBe(false);

    const ambos = pasosTutorial({ ...VACIO, funnelsActivos: 1, origenesActivos: 1 });
    expect(ambos[7].hecho).toBe(true);
  });

  it('el paso 9 (probar) depende de que haya al menos un cobro pagado', () => {
    const sinCobros = pasosTutorial(VACIO);
    expect(sinCobros[8].hecho).toBe(false);

    const conCobro = pasosTutorial({ ...VACIO, cobrosPagados: 1 });
    expect(conCobro[8].hecho).toBe(true);
  });

  it('el paso 7 (pegar el código) se infiere completo solo con un cobro pagado', () => {
    // No hay señal directa de "el HTML está pegado en el funnel externo": vive
    // fuera de este servicio. Se infiere por el efecto (cobró) y no por la causa.
    const sinCobros = pasosTutorial(VACIO);
    expect(sinCobros[6].hecho).toBe(false);

    const conCobro = pasosTutorial({ ...VACIO, cobrosPagados: 1 });
    expect(conCobro[6].hecho).toBe(true);
  });
});

describe('pasosConEstado', () => {
  it('con el snapshot vacío, el paso 1 es el "siguiente" y el resto queda pendiente', () => {
    const pasos = pasosConEstado(VACIO);
    expect(pasos[0].estado).toBe('siguiente');
    expect(pasos.slice(1).every((p) => p.estado === 'pendiente')).toBe(true);
  });

  it('marca como "hecho" los pasos completos anteriores al siguiente', () => {
    const s: SnapshotTutorial = { ...VACIO, credencialesVerificadas: true, webhookRecibioAlgunEvento: true };
    const pasos = pasosConEstado(s);
    expect(pasos[0].estado).toBe('hecho');
    expect(pasos[1].estado).toBe('hecho');
    // El paso 3 (planes/productos) es el primero no hecho.
    expect(pasos[2].estado).toBe('siguiente');
  });

  it('nunca hay más de un paso "siguiente"', () => {
    const pasos = pasosConEstado(VACIO);
    expect(pasos.filter((p) => p.estado === 'siguiente')).toHaveLength(1);
  });

  it('con todo completo, no hay ningún paso "siguiente"', () => {
    const pasos = pasosConEstado(COMPLETO);
    expect(pasos.every((p) => p.estado === 'hecho')).toBe(true);
    expect(pasos.some((p) => p.estado === 'siguiente')).toBe(false);
  });

  it('un paso hecho más adelante en el flujo no lo salta: el orden es lineal', () => {
    // Alguien cargó productos (paso 3/4) y hasta tiene cobros pagados (paso 9),
    // pero nunca conectó Whop de forma verificada (paso 1) — un estado que no
    // debería poder darse en la práctica porque cargar productos necesita
    // credenciales, pero el módulo tiene que seguir señalando el paso 1 como el
    // "siguiente" real: es el primero de la lista que falta, sin importar qué
    // haya pasado más adelante.
    const s: SnapshotTutorial = { ...VACIO, productosConPlan: 3, cobrosPagados: 5 };
    const pasos = pasosConEstado(s);
    expect(pasos[0].estado).toBe('siguiente');
  });
});

describe('progreso', () => {
  it('con el snapshot vacío, 0 de 9', () => {
    expect(progreso(VACIO)).toEqual({ hechos: 0, total: 9 });
  });

  it('con el snapshot completo, 9 de 9', () => {
    expect(progreso(COMPLETO)).toEqual({ hechos: 9, total: 9 });
  });

  it('cuenta parcial correctamente', () => {
    const s: SnapshotTutorial = { ...VACIO, credencialesVerificadas: true, webhookRecibioAlgunEvento: true };
    expect(progreso(s)).toEqual({ hechos: 2, total: 9 });
  });
});

describe('pasoSiguiente', () => {
  it('con el snapshot vacío, devuelve el paso 1', () => {
    const paso = pasoSiguiente(VACIO);
    expect(paso).not.toBeNull();
    expect(paso?.numero).toBe(1);
  });

  it('con todo completo, devuelve null', () => {
    expect(pasoSiguiente(COMPLETO)).toBeNull();
  });

  it('avanza al siguiente paso incompleto a medida que se completan los anteriores', () => {
    let s: SnapshotTutorial = { ...VACIO };
    expect(pasoSiguiente(s)?.numero).toBe(1);

    s = { ...s, credencialesVerificadas: true };
    expect(pasoSiguiente(s)?.numero).toBe(2);

    s = { ...s, webhookRecibioAlgunEvento: true };
    expect(pasoSiguiente(s)?.numero).toBe(3);

    s = { ...s, productosConPlan: 1 };
    // El paso 4 comparte señal con el 3, así que salta directo al 5.
    expect(pasoSiguiente(s)?.numero).toBe(5);
  });
});

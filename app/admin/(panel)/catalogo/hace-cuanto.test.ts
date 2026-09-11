/**
 * Test de la etiqueta de "leído hace…" del botón de actualizar.
 *
 * Es la única lógica del componente que puede estar mal sin que se vea: un
 * redondeo torcido muestra "hace 0 min" cuando pasaron 40 segundos, o "hace 60
 * min" en vez de "hace 1 h". No justifica montar el componente entero, pero sí
 * fijar los bordes de los tres rangos.
 *
 * La función se reimplementa acá porque en el módulo es privada del componente
 * cliente, y exportarla solo para el test agregaría superficie pública a un
 * archivo `'use client'`. El test fija el CONTRATO de los rangos; si el
 * componente cambia su lógica, este test es el que dice cómo tiene que
 * comportarse.
 */
import { describe, expect, it } from 'vitest';

function haceCuanto(desde: number, ahora: number): string {
  const s = Math.max(0, Math.round((ahora - desde) / 1000));
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  return `hace ${Math.round(m / 60)} h`;
}

const T = 1_800_000_000_000;

describe('haceCuanto', () => {
  it('recién leído dice 0 s, no vacío', () => {
    expect(haceCuanto(T, T)).toBe('hace 0 s');
  });

  it('cuenta en segundos hasta el minuto', () => {
    expect(haceCuanto(T, T + 4_000)).toBe('hace 4 s');
    expect(haceCuanto(T, T + 59_000)).toBe('hace 59 s');
  });

  it('cruza a minutos justo en 60 s', () => {
    expect(haceCuanto(T, T + 60_000)).toBe('hace 1 min');
    expect(haceCuanto(T, T + 200_000)).toBe('hace 3 min');
  });

  it('cruza a horas y no dice "60 min"', () => {
    // 59,5 min redondea a 60 min, y ahí tiene que pasar a horas.
    expect(haceCuanto(T, T + 3_570_000)).toBe('hace 1 h');
    expect(haceCuanto(T, T + 7_200_000)).toBe('hace 2 h');
  });

  // El reloj del cliente puede ir atrasado respecto del server, así que la
  // diferencia puede dar negativa. Sin el clamp mostraría "hace -3 s".
  it('con el reloj del cliente atrasado no muestra negativos', () => {
    expect(haceCuanto(T, T - 5_000)).toBe('hace 0 s');
  });
});

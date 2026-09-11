/**
 * Tests de `lib/rate-limit.ts`.
 *
 * El reloj se inyecta en vez de usar `vi.useFakeTimers()`: el vencimiento de la
 * ventana es la parte que más fácil se escribe mal (un `>=` en vez de un `>`
 * deja el límite corriendo para siempre), y probarlo con un reloj explícito hace
 * que el test diga exactamente en qué milisegundo esperaba qué.
 */
import { describe, expect, it } from 'vitest';
import { crearLimitador, ipDelRequest } from './rate-limit';

describe('crearLimitador', () => {
  it('deja pasar hasta el límite y corta en el siguiente', () => {
    const lim = crearLimitador(3, 60_000, () => 1000);
    expect(lim.excede('a')).toBe(false); // 1
    expect(lim.excede('a')).toBe(false); // 2
    expect(lim.excede('a')).toBe(false); // 3
    expect(lim.excede('a')).toBe(true); // 4 → corta
  });

  it('cuenta por clave, no globalmente', () => {
    // Si contara global, el visitante número 4 quedaría bloqueado por la
    // actividad de otros tres. Es el bug que convierte un rate limit en una
    // caída de ventas.
    const lim = crearLimitador(1, 60_000, () => 1000);
    expect(lim.excede('ip-1')).toBe(false);
    expect(lim.excede('ip-2')).toBe(false);
    expect(lim.excede('ip-3')).toBe(false);
    expect(lim.excede('ip-1')).toBe(true);
  });

  it('abre una ventana nueva cuando pasó el tiempo', () => {
    let t = 1000;
    const lim = crearLimitador(2, 60_000, () => t);
    expect(lim.excede('a')).toBe(false);
    expect(lim.excede('a')).toBe(false);
    expect(lim.excede('a')).toBe(true);

    t = 1000 + 60_001; // justo pasada la ventana
    expect(lim.excede('a')).toBe(false);
  });

  it('NO abre ventana nueva exactamente en el borde', () => {
    // `t - desde > ventana`, no `>=`: en el milisegundo exacto la ventana sigue
    // siendo la misma. Fijado para que nadie lo cambie a `>=` "por prolijidad".
    let t = 1000;
    const lim = crearLimitador(1, 60_000, () => t);
    expect(lim.excede('a')).toBe(false);
    t = 1000 + 60_000; // el borde exacto
    expect(lim.excede('a')).toBe(true);
  });

  it('un límite de 0 corta desde la primera llamada', () => {
    const lim = crearLimitador(0, 60_000, () => 1000);
    expect(lim.excede('a')).toBe(true);
  });

  it('poda las claves vencidas y no crece sin techo', () => {
    let t = 1000;
    const lim = crearLimitador(5, 60_000, () => t);
    for (let i = 0; i < 50; i++) lim.excede(`ip-${i}`);
    expect(lim.tamano()).toBe(50);

    // Pasa la ventana y entra una clave nueva: la poda oportunista limpia las 50
    // vencidas. Sin esto el Map crece para siempre en un endpoint público.
    t = 1000 + 60_001;
    lim.excede('ip-nueva');
    expect(lim.tamano()).toBe(1);
  });

  it('dos limitadores son independientes', () => {
    // Agotar el del checkout no puede bloquear el del cobro.
    const a = crearLimitador(1, 60_000, () => 1000);
    const b = crearLimitador(1, 60_000, () => 1000);
    expect(a.excede('x')).toBe(false);
    expect(a.excede('x')).toBe(true);
    expect(b.excede('x')).toBe(false);
  });
});

describe('ipDelRequest', () => {
  function req(headers: Record<string, string>): Request {
    return new Request('https://ejemplo.com', { headers });
  }

  it('toma el PRIMER valor de x-forwarded-for, que es el cliente real', () => {
    // Los siguientes son los proxies intermedios. Tomar el último agruparía a
    // todos los visitantes bajo la IP del proxy.
    expect(ipDelRequest(req({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1, 172.16.0.1' }))).toBe('1.2.3.4');
  });

  it('cae a x-real-ip, que es el que setea el Caddyfile de este servicio', () => {
    expect(ipDelRequest(req({ 'x-real-ip': '5.6.7.8' }))).toBe('5.6.7.8');
  });

  it('prefiere x-forwarded-for sobre x-real-ip', () => {
    expect(ipDelRequest(req({ 'x-forwarded-for': '1.1.1.1', 'x-real-ip': '2.2.2.2' }))).toBe('1.1.1.1');
  });

  it('sin ningún header devuelve una clave FIJA, no una aleatoria', () => {
    // Con una clave aleatoria por request el límite no existiría. Una clave fija
    // vuelve el límite global, que es el lado seguro.
    expect(ipDelRequest(req({}))).toBe('sin-ip');
    expect(ipDelRequest(req({}))).toBe('sin-ip');
  });

  it('un x-forwarded-for vacío no produce una clave vacía', () => {
    expect(ipDelRequest(req({ 'x-forwarded-for': '   ' }))).toBe('sin-ip');
  });
});

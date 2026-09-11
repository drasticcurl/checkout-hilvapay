/**
 * Rate limit en memoria, por clave y por ventana de tiempo.
 *
 * Sale de `app/api/checkout/sesion/route.ts`, donde vivía como tres funciones
 * privadas, porque la auditoría del 2026-09-11 encontró que
 * `POST /api/upsell/cobrar` —el endpoint que COBRA— no tenía ninguno. Copiarlo a
 * mano al segundo lugar es cómo terminan divergiendo: uno se arregla y el otro no.
 *
 * ── Qué frena y qué NO ──────────────────────────────────────────────────────
 * Frena el bucle: un doble submit, un script de prueba mal cortado, un botón que
 * dispara en un `useEffect` sin deps. Eso es la mayoría de lo que pasa de verdad.
 *
 * NO es un rate limiter distribuido ni una defensa contra un atacante decidido:
 * el estado vive en el proceso, así que un `pm2 reload` lo reinicia y un segundo
 * proceso tendría su propio contador. Para este servicio alcanza —corre como UN
 * proceso de PM2 (ver README)— y lo que protege el cobro de verdad es otra cosa:
 * la allowlist de `origenes` para el CORS, el token de 256 bits de la orden, y el
 * índice único `(orden_id, pagina_id)` de `cobros`, que hace imposible el doble
 * cobro incluso sin este límite.
 *
 * Tampoco frena a alguien con muchas IPs. Delante hay Cloudflare (verificado:
 * las respuestas de producción traen `cf-ray`), que es la capa donde ese caso se
 * resuelve.
 *
 * ── Por qué la memoria no crece sin techo ───────────────────────────────────
 * `Map` sin poda crece con cada IP nueva y nunca libera: en un endpoint público
 * eso es una fuga lenta. `limpiar()` corre de forma oportunista en cada consulta,
 * amortizado y sin `setInterval` — un timer en un route handler de Next mantiene
 * el proceso despierto y se duplica en cada recarga de módulo en dev.
 */

/** Una ventana de conteo para una clave. */
type Ventana = { cuenta: number; desde: number };

export type Limitador = {
  /** `true` si esta llamada excede el límite. Cuenta la llamada actual. */
  excede: (clave: string) => boolean;
  /** Solo para tests: vacía el estado. */
  reset: () => void;
  /** Solo para tests: cuántas claves hay en memoria. */
  tamano: () => number;
};

/**
 * Crea un limitador independiente. Cada endpoint tiene el suyo, así que agotar
 * el del checkout no bloquea el del cobro: son riesgos distintos y límites
 * distintos.
 *
 * `ahora` es inyectable para poder probar el vencimiento de la ventana sin
 * `setTimeout` ni relojes falsos globales.
 */
export function crearLimitador(
  limitePorVentana: number,
  ventanaMs = 60_000,
  ahora: () => number = Date.now,
): Limitador {
  const porClave = new Map<string, Ventana>();
  // Techo de claves vivas. 10 000 entradas son ~1 MB: mucho para un bucle
  // accidental, poco para la memoria del proceso.
  const MAX_CLAVES = 10_000;

  function limpiar(t: number): void {
    // `forEach` y no `for...of`: el `target` del tsconfig es ES5 y recorrer un
    // Map con for...of exige `downlevelIteration`. Mismo criterio que el
    // `Array.from` de lib/admin/integracion.ts — no se toca la config del
    // proyecto por una línea.
    const vencidas: string[] = [];
    porClave.forEach((v, clave) => {
      if (t - v.desde > ventanaMs) vencidas.push(clave);
    });
    vencidas.forEach((clave) => porClave.delete(clave));

    // Si después de podar las vencidas sigue por encima del techo, es un ataque
    // distribuido o un bug: se tira todo. Perder los contadores es preferible a
    // que el Map crezca sin límite, y el efecto es un minuto sin rate limit, no
    // un cobro indebido — de eso se ocupan el índice único y la allowlist.
    if (porClave.size > MAX_CLAVES) porClave.clear();
  }

  return {
    excede(clave: string): boolean {
      const t = ahora();
      const v = porClave.get(clave);

      if (!v || t - v.desde > ventanaMs) {
        // La poda va acá y no en cada llamada: solo cuando se abre una ventana
        // nueva, que es cuando el Map pudo haber crecido.
        if (porClave.size > 0) limpiar(t);
        porClave.set(clave, { cuenta: 1, desde: t });
        // Se compara igual en la ventana nueva, no `return false` directo: con
        // `limitePorVentana = 0` la primera llamada YA excede. Un `return false`
        // acá dejaría pasar una por ventana, y "límite 0" tiene que poder
        // significar "cerrado" — es la forma de apagar un endpoint sin
        // redeployar.
        return 1 > limitePorVentana;
      }

      v.cuenta += 1;
      return v.cuenta > limitePorVentana;
    },
    reset(): void {
      porClave.clear();
    },
    tamano(): number {
      return porClave.size;
    },
  };
}

/**
 * La IP del visitante, para usar como clave.
 *
 * `x-forwarded-for` primero porque Caddy termina el TLS y proxea a
 * `127.0.0.1:3020`: sin ese header todas las IPs serían la del proxy y el límite
 * sería global en vez de por visitante. Se toma el PRIMER valor de la lista, que
 * es el cliente original; los siguientes son los proxies intermedios.
 *
 * El header lo puede falsificar quien llegue sin pasar por el proxy, así que esto
 * NO es un control de seguridad: es agrupamiento. Un atacante que rota el header
 * evade el límite, y para eso está Cloudflare delante.
 *
 * `'sin-ip'` como default y no un valor aleatorio: si el header faltara para
 * todos, el límite pasa a ser global, que es el lado seguro. Con una clave
 * aleatoria por request el límite simplemente no existiría.
 */
export function ipDelRequest(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const primera = xff.split(',')[0].trim();
    if (primera) return primera;
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'sin-ip';
}

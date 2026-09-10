/**
 * De dónde salen las credenciales de Whop, y cómo se cambian sin redeployar.
 *
 * Hay dos fuentes y un orden fijo:
 *
 *   1. La fila única de `config` (migración 006), si tiene una API key guardada.
 *   2. Las variables de entorno.
 *
 * La base es un **override**, no un reemplazo. El env sigue siendo obligatorio en
 * `deploy/deploy.sh` y en `/api/health`, y eso es deliberado: garantiza que el
 * servicio pueda hablar con Whop incluso con la tabla `config` vacía o con la
 * clave de cifrado perdida. Sin ese piso, un error en esta pantalla dejaría el
 * checkout sin poder cobrar y sin camino de vuelta que no sea un deploy.
 *
 * ── Por qué hay caché en proceso ────────────────────────────────────────────
 * `whopFetch` resuelve las credenciales en CADA llamada. Sin caché, cada cobro
 * agregaría un round-trip a Postgres antes de salir a la red, y el descifrado de
 * la key encima. La app corre como UN proceso de PM2 (ver README), así que un
 * caché en memoria con invalidación explícita al guardar es coherente: no hay un
 * segundo proceso que pueda quedar con el valor viejo.
 *
 * El TTL igual existe como red: si algún día hay dos procesos, lo peor que pasa
 * es que uno siga con la key anterior por 30 segundos, en vez de para siempre.
 */
import { q1 } from './db';
import { CifradoInvalido, SinClaveDeCifrado, cifrar, descifrar, enmascarar, hayClaveDeCifrado, huella } from './cripto';

export type Credenciales = {
  apiKey: string;
  companyId: string;
  base: string;
  versionDate: string;
};

/** De dónde salió cada cosa. Lo muestra el panel y lo expone `/api/health`. */
export type FuenteCredenciales = 'base' | 'entorno';

type FilaConfig = {
  whop_api_key_cifrada: string | null;
  whop_company_id: string | null;
  whop_api_base: string | null;
  whop_api_version_date: string | null;
  whop_verificado_at: Date | null;
  whop_company_nombre: string | null;
  whop_api_key_huella: string | null;
};

const TTL_CACHE_MS = 30_000;

let cache: { valor: Credenciales; fuente: FuenteCredenciales; vence: number } | null = null;

/**
 * Tira el caché. La llama el guardado, para que el cobro siguiente ya salga con
 * la credencial nueva y no haya que esperar el TTL.
 */
export function invalidarCacheCredenciales(): void {
  cache = null;
}

function normalizarBase(base: string): string {
  return base.trim().replace(/\/$/, '');
}

async function leerFila(): Promise<FilaConfig | null> {
  try {
    return await q1<FilaConfig>(
      `select whop_api_key_cifrada, whop_company_id, whop_api_base,
              whop_api_version_date, whop_verificado_at, whop_company_nombre,
              whop_api_key_huella
         from config where id = 1`,
    );
  } catch (err) {
    // La migración 006 puede no estar aplicada todavía (por ejemplo, entre el
    // deploy y la migración, o en un entorno viejo). Eso NO puede tumbar un
    // cobro: se cae a las variables de entorno, que es exactamente el estado
    // anterior a esta feature.
    console.error('[whop-credenciales] no se pudo leer config, se usa el entorno:', err);
    return null;
  }
}

function credencialesDelEntorno(): Credenciales {
  const apiKey = process.env.WHOP_API_KEY;
  const companyId = process.env.WHOP_COMPANY_ID;
  const base = process.env.WHOP_API_BASE;
  const versionDate = process.env.WHOP_API_VERSION_DATE;

  if (!apiKey) throw new Error('WHOP_API_KEY no está configurada');
  if (!companyId) throw new Error('WHOP_COMPANY_ID no está configurada');
  if (!base) throw new Error('WHOP_API_BASE no está configurada');
  // Sin el pin de versión, un cambio de la API rompe producción sin aviso. Y
  // como el valor forma parte de la clave de idempotencia del lado de Whop, que
  // esté vacío también rompería el replay de los reintentos.
  if (!versionDate) throw new Error('WHOP_API_VERSION_DATE no está configurada');

  return { apiKey, companyId, base: normalizarBase(base), versionDate };
}

/**
 * Las credenciales que hay que usar ahora. Nunca devuelve una mezcla a medias: si
 * la fila tiene una key guardada, los cuatro valores salen de la fila (cayendo al
 * env campo por campo solo para los tres que no son secretos, que es donde
 * mezclar no puede cobrarle a la cuenta equivocada).
 *
 * Si la key guardada no se puede descifrar, se cae al entorno y se loguea. Es la
 * decisión importante de este archivo: preferir cobrar con la credencial anterior
 * a no cobrar.
 */
export async function resolverCredenciales(): Promise<{
  credenciales: Credenciales;
  fuente: FuenteCredenciales;
}> {
  if (cache && cache.vence > Date.now()) {
    return { credenciales: cache.valor, fuente: cache.fuente };
  }

  const fila = await leerFila();
  let resuelto: { credenciales: Credenciales; fuente: FuenteCredenciales } | null = null;

  if (fila?.whop_api_key_cifrada) {
    try {
      const apiKey = await descifrar(fila.whop_api_key_cifrada);
      const entorno = process.env;
      const companyId = fila.whop_company_id ?? entorno.WHOP_COMPANY_ID;
      const base = fila.whop_api_base ?? entorno.WHOP_API_BASE;
      const versionDate = fila.whop_api_version_date ?? entorno.WHOP_API_VERSION_DATE;

      if (companyId && base && versionDate) {
        resuelto = {
          credenciales: { apiKey, companyId, base: normalizarBase(base), versionDate },
          fuente: 'base',
        };
      } else {
        console.error(
          '[whop-credenciales] hay key guardada pero falta company/base/version; se usa el entorno',
        );
      }
    } catch (err) {
      const motivo =
        err instanceof SinClaveDeCifrado
          ? 'falta CONFIG_ENCRYPTION_KEY'
          : err instanceof CifradoInvalido
            ? err.message
            : String(err);
      console.error(`[whop-credenciales] la key guardada no se pudo descifrar (${motivo}); se usa el entorno`);
    }
  }

  if (!resuelto) resuelto = { credenciales: credencialesDelEntorno(), fuente: 'entorno' };

  cache = { valor: resuelto.credenciales, fuente: resuelto.fuente, vence: Date.now() + TTL_CACHE_MS };
  return resuelto;
}

/* ─────────────────────────── Verificación contra Whop ─────────────────────── */

export type ResultadoVerificacion =
  | { ok: true; companyNombre: string }
  | { ok: false; motivo: string; status?: number };

const TIMEOUT_VERIFICACION_MS = 12_000;

/**
 * Confirma un juego de credenciales contra la API real, ANTES de guardarlo.
 *
 * Usa `GET /companies/{biz_id}`, que es el único endpoint que sirve para sondear.
 * Está medido y documentado en el README: `/accounts/me` da 403 por un scope que
 * no está entre los permisos, `/companies/me` responde 200 pero de OTRA company
 * (la personal del usuario), y `/plans` y `/products` sin `account_id` devuelven
 * 400 o —peor— 200 con el catálogo público de Whop, que parece un éxito.
 *
 * No pasa por `whopFetch` a propósito, y no es duplicación por descuido:
 * `whopFetch` resuelve las credenciales guardadas, y acá hay que probar unas que
 * todavía NO están guardadas. Hacerlo por ahí obligaría a agregarle un modo
 * "usá estas otras credenciales" al cliente que ejecuta los cobros, que es el
 * archivo donde menos conviene agregar caminos.
 */
export async function verificarCredenciales(c: Credenciales): Promise<ResultadoVerificacion> {
  const base = normalizarBase(c.base);
  const señal = AbortSignal.timeout(TIMEOUT_VERIFICACION_MS);

  let res: Response;
  try {
    res = await fetch(`${base}/companies/${encodeURIComponent(c.companyId)}`, {
      headers: {
        Authorization: `Bearer ${c.apiKey}`,
        'Content-Type': 'application/json',
        'Api-Version-Date': c.versionDate,
      },
      signal: señal,
      cache: 'no-store',
    });
  } catch (err) {
    const abortada = err instanceof Error && err.name === 'TimeoutError';
    return {
      ok: false,
      motivo: abortada
        ? `Whop no contestó en ${TIMEOUT_VERIFICACION_MS / 1000} segundos. Revisá WHOP_API_BASE.`
        : `No se pudo conectar con ${base}. Revisá que la URL sea correcta.`,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      status: res.status,
      motivo:
        'Whop rechazó la API key. Si la copiaste de una cuenta sandbox, acordate que en sandbox esta key da 401.',
    };
  }
  if (res.status === 404) {
    return {
      ok: false,
      status: 404,
      motivo: `Whop no encuentra la company "${c.companyId}". Revisá el biz id.`,
    };
  }
  if (!res.ok) {
    let detalle = '';
    try {
      detalle = (await res.text()).slice(0, 200);
    } catch {
      /* el cuerpo no importa tanto como el status */
    }
    return { ok: false, status: res.status, motivo: `Whop respondió ${res.status}. ${detalle}`.trim() };
  }

  let cuerpo: unknown;
  try {
    cuerpo = await res.json();
  } catch {
    return { ok: false, motivo: 'Whop respondió 200 pero con un cuerpo que no es JSON.' };
  }

  const obj = (cuerpo ?? {}) as Record<string, unknown>;
  // La forma cambió entre versiones de la API, así que se aceptan las dos y se
  // cae al id: el nombre es para mostrar, no para decidir.
  const nombre =
    (typeof obj.title === 'string' && obj.title) ||
    (typeof obj.name === 'string' && obj.name) ||
    null;

  // El chequeo que evita el falso positivo: que el id que devolvió sea el que se
  // pidió. Sin esto, un endpoint que ignora el path y contesta con otra company
  // (que es exactamente lo que hace `/companies/me`) pasaría como válido.
  const idDevuelto = typeof obj.id === 'string' ? obj.id : null;
  if (idDevuelto && idDevuelto !== c.companyId) {
    return {
      ok: false,
      motivo: `Whop respondió con la company "${idDevuelto}" en vez de "${c.companyId}".`,
    };
  }

  return { ok: true, companyNombre: nombre ?? c.companyId };
}

/* ───────────────────── Identificar la company desde la key ────────────────── */

export type ResultadoIdentificacion =
  | { ok: true; companyId: string; companyNombre: string }
  | { ok: false; motivo: string; status?: number };

/**
 * Averigua a qué company pertenece una API key, sin que nadie tenga que copiar el
 * `biz_` a mano.
 *
 * ── El endpoint, y por qué NO es el de v1 ────────────────────────────────────
 * Usa `GET /api/v5/company`. El README tenía documentado que no se podía, y era
 * cierto **para v1**: `v1/companies/me` responde 200 pero con la company PERSONAL
 * del usuario (medido: devuelve `biz_mq2nWbR4AjIBlZ`, título "Me", en vez de la
 * del negocio). Lo que faltaba probar es que el mismo concepto en v2 y v5 sí
 * devuelve la del negocio.
 *
 * Medido el 2026-09-10 contra la API real:
 *   · `v5/company` → 200 con el id y el título correctos de la company del negocio
 *   · `v2/company` → lo mismo, con menos campos
 *   · `v1/companies/me` → 200 con la company equivocada
 *   · `v1/accounts/me` → 403 por el scope `company:balance:read`
 *   · con una key inválida → 403 con un mensaje claro, NUNCA una company al azar
 *   · `v2/companies` → 401 y `v5/companies` → 404: una key ve una sola company,
 *     así que no hay ambigüedad de "cuál de todas"
 *
 * ── Dos decisiones deliberadas ──────────────────────────────────────────────
 * 1. **No manda `Api-Version-Date`.** v2 y v5 se versionan por path y el header lo
 *    ignoran (probado con un `1999-01-01` inventado: responde igual). Mandarlo
 *    sugeriría que el pin del proyecto gobierna esta llamada, y no lo hace.
 *
 * 2. **Esto NO reemplaza a `verificarCredenciales`.** Es prefill y chequeo
 *    cruzado. El guardado lo sigue habilitando `GET /companies/{biz_id}`, que es
 *    v1 — la misma versión que usan los cobros. Si Whop cambiara `v5/company`, se
 *    pierde la comodidad de identificar, no la capacidad de configurar.
 */
export async function identificarCompany(
  apiKey: string,
  baseConfigurada: string,
): Promise<ResultadoIdentificacion> {
  // Se deriva del origen de la base configurada y no se hardcodea el host: si el
  // servicio apunta a otro host, identificar lo sigue.
  let origen: string;
  try {
    origen = new URL(baseConfigurada).origin;
  } catch {
    return { ok: false, motivo: 'La URL base no es válida, así que no se puede identificar la cuenta.' };
  }

  let res: Response;
  try {
    res = await fetch(`${origen}/api/v5/company`, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_VERIFICACION_MS),
      cache: 'no-store',
    });
  } catch (err) {
    const abortada = err instanceof Error && err.name === 'TimeoutError';
    return {
      ok: false,
      motivo: abortada ? 'Whop no contestó en tiempo.' : `No se pudo conectar con ${origen}.`,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, motivo: 'Whop no reconoce esa API key.' };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      motivo: `Whop respondió ${res.status} al identificar la cuenta. Podés poner el biz id a mano.`,
    };
  }

  let cuerpo: unknown;
  try {
    cuerpo = await res.json();
  } catch {
    return { ok: false, motivo: 'Whop respondió algo que no es JSON.' };
  }

  const obj = (cuerpo ?? {}) as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id : null;
  const nombre =
    (typeof obj.title === 'string' && obj.title) || (typeof obj.name === 'string' && obj.name) || null;

  if (!id) return { ok: false, motivo: 'Whop contestó sin id de company.' };
  // El chequeo que evita repetir el problema de v1: la company personal se llama
  // "Me" y su route es "me". Si aparece eso, es el endpoint equivocado.
  if (obj.route === 'me') {
    return { ok: false, motivo: 'Whop devolvió la cuenta personal y no la del negocio. Poné el biz id a mano.' };
  }

  return { ok: true, companyId: id, companyNombre: nombre ?? id };
}

/* ───────────────────────────── Guardado y estado ──────────────────────────── */

/**
 * Guarda las credenciales YA VERIFICADAS y tira el caché.
 *
 * No verifica acá adentro a propósito: quien llama decide si el juego pasó la
 * prueba, y así esta función tiene una sola responsabilidad. El endpoint del
 * panel es el que garantiza que no se guarde nada sin verificar.
 */
export async function guardarCredenciales(
  c: Credenciales,
  companyNombre: string,
): Promise<void> {
  if (!hayClaveDeCifrado()) throw new SinClaveDeCifrado();

  const sobre = await cifrar(c.apiKey);
  const marca = await huella(c.apiKey);

  await q1(
    `update config
        set whop_api_key_cifrada  = $1,
            whop_api_key_huella   = $2,
            whop_company_id       = $3,
            whop_api_base         = $4,
            whop_api_version_date = $5,
            whop_company_nombre   = $6,
            whop_verificado_at    = now(),
            updated_at            = now()
      where id = 1
      returning id`,
    [sobre, marca, c.companyId, normalizarBase(c.base), c.versionDate, companyNombre],
  );

  invalidarCacheCredenciales();
}

/**
 * Vuelve a las variables de entorno: borra el override de la base. Es el camino
 * de vuelta si alguien guarda una credencial equivocada y el panel deja de poder
 * hablar con Whop.
 */
export async function volverAlEntorno(): Promise<void> {
  await q1(
    `update config
        set whop_api_key_cifrada  = null,
            whop_api_key_huella   = null,
            whop_company_id       = null,
            whop_api_base         = null,
            whop_api_version_date = null,
            whop_company_nombre   = null,
            whop_verificado_at    = null,
            updated_at            = now()
      where id = 1
      returning id`,
  );
  invalidarCacheCredenciales();
}

export type EstadoCredenciales = {
  fuente: FuenteCredenciales;
  /** Solo los últimos 4 caracteres. Nunca la key. */
  apiKeyEnmascarada: string;
  companyId: string;
  base: string;
  versionDate: string;
  /** El nombre que devolvió Whop la última vez que se verificó, si hay override. */
  companyNombre: string | null;
  verificadoAt: string | null;
  hayClaveDeCifrado: boolean;
  /** true si el entorno tiene las cuatro: es el piso al que se puede volver. */
  entornoCompleto: boolean;
  /** Presente solo si algo está mal y hay que decirlo en pantalla. */
  problema: string | null;
};

/**
 * Lo que el panel necesita para dibujar la pantalla. **Nunca devuelve la API
 * key**, ni la del entorno ni la guardada: solo los últimos cuatro caracteres.
 */
export async function estadoCredenciales(): Promise<EstadoCredenciales> {
  const fila = await leerFila();

  let entornoCompleto = true;
  try {
    credencialesDelEntorno();
  } catch {
    entornoCompleto = false;
  }

  let problema: string | null = null;
  if (fila?.whop_api_key_cifrada && !hayClaveDeCifrado()) {
    problema =
      'Hay una API key guardada en la base pero falta CONFIG_ENCRYPTION_KEY, así que no se puede descifrar. El servicio está usando la del entorno.';
  }

  try {
    const { credenciales, fuente } = await resolverCredenciales();
    return {
      fuente,
      apiKeyEnmascarada: enmascarar(credenciales.apiKey),
      companyId: credenciales.companyId,
      base: credenciales.base,
      versionDate: credenciales.versionDate,
      companyNombre: fuente === 'base' ? fila?.whop_company_nombre ?? null : null,
      verificadoAt: fuente === 'base' ? fila?.whop_verificado_at?.toISOString() ?? null : null,
      hayClaveDeCifrado: hayClaveDeCifrado(),
      entornoCompleto,
      problema,
    };
  } catch (err) {
    // Ni base ni entorno: el panel tiene que poder dibujarse igual para que se
    // pueda arreglar DESDE acá. Si esto tirara, la pantalla que sirve para
    // configurar las credenciales sería la que no carga por no tenerlas.
    return {
      fuente: 'entorno',
      apiKeyEnmascarada: '····',
      companyId: '',
      base: process.env.WHOP_API_BASE ?? '',
      versionDate: process.env.WHOP_API_VERSION_DATE ?? '',
      companyNombre: null,
      verificadoAt: null,
      hayClaveDeCifrado: hayClaveDeCifrado(),
      entornoCompleto: false,
      problema: err instanceof Error ? err.message : String(err),
    };
  }
}

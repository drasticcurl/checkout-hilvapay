# T01 — Fundación: contratos congelados en código real

- **Depende de:** nada
- **Bloquea:** T02, T03, T04 (los tres importan los tipos que esta task declara)
- **Se puede correr en paralelo con:** nada. **Corre sola y primero.**
- **Repos:** checkout-kashhhpay Y dashboard-admin (esta task toca los dos, porque el contrato cruza la
  frontera entre ambos)
- **Archivos que este task puede tocar:**
  - `checkout-kashhhpay/lib/tipos.ts` (agregar los tipos nuevos al final, sin tocar los existentes)
  - `checkout-kashhhpay/lib/capi-tipos.ts` (nuevo)
  - `dashboard-admin/lib/orders/checkout-propio-tipos.ts` (nuevo)

Leé `00-PLAN-PANEL-Y-CAPI.md` completo antes de empezar. Tu contrato es **todo el §4, §5 y §6**: los
tres bloques de código TypeScript de esos parágrafos son los que copiás literal, con JSDoc, SIN
implementación. No agregues campos que el plan no pida, no le cambies el nombre a ninguno — T02, T03 y
T04 se escriben contra estos tipos exactos al mismo tiempo que vos terminás esta task.

## 1. Objetivo

Cuando termines, tienen que existir en el repo estos archivos, y `npx tsc --noEmit` debe salir con exit code 0 en ambos repos:

- El tipo `PayloadVentaCheckoutPropio` y `RespuestaVentaCheckoutPropio` (contrato A), disponibles para
  importar desde checkout-kashhhpay (quien lo arma y lo manda) y desde dashboard-admin (quien lo
  recibe).
- Los tipos `CapiTarget`, `EventoCapiPurchase`, `ResultadoArmadoCapi` (contrato B), en
  checkout-kashhhpay.
- El tipo `PayloadIngest` extendido con `context.utms` opcional (contrato C), en checkout-kashhhpay.

**Este task no implementa ninguna función real (`armarEventoCapi`, `sendCapiEvent`, el handler del
endpoint). Esas son T02/T03/T04. Este task solo declara las FORMAS.**

## 2. Contrato A — dos archivos hermanos, un tipo idéntico

Como los dos repos son proyectos Next.js separados (no hay un paquete compartido entre
checkout-kashhhpay y dashboard-admin — verificado: cada uno tiene su propio `package.json` y no hay un
monorepo/workspace), **el contrato se declara DOS VECES, una por repo, con un comentario que dice
explícitamente que es un espejo del otro.** Esto no es una excepción a "un contrato, una declaración":
es la única forma de tener el tipo disponible en ambos lados sin inventar infraestructura de paquetes
compartidos para una sola interfaz.

En `checkout-kashhhpay/lib/capi-tipos.ts` (nuevo archivo — el nombre NO es `capi.ts` porque ese lo crea
T04 con las funciones; este archivo es solo tipos, así T04 puede importar de acá sin ciclos):

```ts
/**
 * Contrato A (00-PLAN-PANEL-Y-CAPI.md §4) — el payload que checkout-kashhhpay
 * manda a POST /api/webhooks/checkout-propio de dashboard-admin.
 *
 * ESPEJO: dashboard-admin/lib/orders/checkout-propio-tipos.ts declara el
 * mismo tipo con el mismo nombre. Si cambiás este archivo, cambiá el otro.
 * No hay paquete compartido entre los dos repos — son proyectos Next.js
 * independientes — así que la sincronización es manual y a propósito.
 */
export type PayloadVentaCheckoutPropio = {
  cobroId: string;
  whopPlanId: string;
  email: string | null;
  monto: string;
  moneda: string;
  purchasedAt: string;
  utms: {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    utm_term?: string;
  };
  fbclid?: string;
  sessionId?: string;
  visitorId?: string;
};

export type RespuestaVentaCheckoutPropio =
  | { ok: true; orderId: number; isNew: boolean; funnelId: number | null }
  | { ok: true; orderId: null; isNew: false }
  | { ok: false; error: string };
```

En `dashboard-admin/lib/orders/checkout-propio-tipos.ts` (nuevo archivo): el mismo bloque de arriba,
con el comentario de espejo apuntando de vuelta a `checkout-kashhhpay/lib/capi-tipos.ts`.

## 3. Contrato B — solo en checkout-kashhhpay

En `checkout-kashhhpay/lib/capi-tipos.ts` (mismo archivo del paso 2, se agrega debajo):

```ts
/** Contrato B (00-PLAN-PANEL-Y-CAPI.md §5) — el evento que lib/capi.ts (T04) manda a Meta. */
export type CapiTarget = { pixelId: string; accessToken: string };

export type EventoCapiPurchase = {
  event_name: 'Purchase';
  event_time: number;
  event_id: string;
  action_source: 'website';
  event_source_url: string;
  user_data: {
    em?: string[];
    fbc?: string;
  };
  custom_data: {
    value: number;
    currency: string;
  };
};

export type ResultadoArmadoCapi =
  | { ok: true; evento: EventoCapiPurchase }
  | { ok: false; motivo: string };
```

## 4. Contrato C — extender `PayloadIngest` en `lib/salidas.ts`

**Este es el único caso donde tocás un archivo que no es tuyo por completo.** `lib/salidas.ts` ya
existe y T03 lo va a extender más — tu única responsabilidad acá es agregar el campo `utms` al tipo
`PayloadIngest` que ya está declarado ahí, para que el contrato quede congelado antes de que T03 escriba
la lógica que lo llena.

Abrí `checkout-kashhhpay/lib/salidas.ts`, buscá el tipo `PayloadIngest` (está cerca del final, junto a
`EventoIngest`), y agregale el campo `utms` a `context`, así:

```ts
export type PayloadIngest = {
  sessionId: string;
  visitorId: string;
  variant: string;
  events: EventoIngest[];
  context: {
    path: string;
    /**
     * Nuevo (00-PLAN-PANEL-Y-CAPI.md §6, contrato C). T03 lo llena en
     * armarPayloadIngest(). Opcional: el schema de destino (dashboard-admin
     * lib/ingest/schema.ts, contextSchema) ya lo esperaba como opcional antes
     * de este cambio, así que agregar el campo no rompe ningún consumidor
     * existente que no lo mande.
     */
    utms?: {
      utm_source?: string;
      utm_medium?: string;
      utm_campaign?: string;
      utm_content?: string;
      utm_term?: string;
    };
  };
};
```

**No tocás la función `armarPayloadIngest` en sí ni ningún otro tipo de ese archivo.** Solo esta forma.
T03 es quien escribe la lógica que arma el objeto con el campo nuevo lleno.

## 5. Tests

Este task no tiene lógica que testear (son solo declaraciones de tipo). La verificación es que
compile.

## 6. Verificación

```bash
# 1 — checkout-kashhhpay: el archivo nuevo compila y no rompe nada existente
cd checkout-kashhhpay && npx tsc --noEmit
# esperado: 0 errores (los mismos que había antes de este cambio, si el repo ya tenía alguno preexistente — comparar antes/después)

# 2 — dashboard-admin: mismo chequeo
cd ../dashboard-admin && npx tsc --noEmit
# esperado: 0 errores nuevos

# 3 — confirmar que los 3 archivos nuevos existen
ls -la checkout-kashhhpay/lib/capi-tipos.ts dashboard-admin/lib/orders/checkout-propio-tipos.ts
# esperado: ambos archivos existen

# 4 — confirmar que PayloadIngest tiene el campo utms
grep -A3 "context:" checkout-kashhhpay/lib/salidas.ts | grep -c "utms"
# esperado: 1 (al menos una ocurrencia)
```

## 7. Cuándo parar

**Bloqueante, pará y avisá:**
- Si `npx tsc --noEmit` falla en cualquiera de los dos repos por un error que ya existía ANTES de tu
  cambio (no relacionado a los tipos nuevos): no es tu bug, pero avisá antes de que T02/T03/T04 asuman
  que el baseline estaba limpio.
- Si encontrás que checkout-kashhhpay y dashboard-admin SÍ comparten algún mecanismo de tipos (un
  paquete npm privado, un symlink, algo que no se detectó en el análisis previo): pará, es una
  decisión de arquitectura distinta a la que asumió este plan.

**Anotalo en §10 del plan y seguí:**
- Cualquier ajuste menor de nombre de campo que te parezca necesario — no lo decidas solo, anotalo y
  usá el nombre del plan igual mientras tanto.

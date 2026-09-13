# LEER PRIMERO — antes de abrir cualquier T0N de esta carpeta

**`tasks/checkout-whop/` (la carpeta hermana, un nivel arriba) es solo referencia histórica. No la
sigas, no la cites como fuente de una decisión nueva, y no la uses como ejemplo de cómo implementar
nada de este módulo.**

## Por qué existe esta advertencia

`tasks/checkout-whop/` documenta cómo se construyó el checkout base (el que hoy cobra tarjetas reales
en producción, `pay.hilvanapp.com`). En su momento fue el plan vigente y sus tasks (T01-T06) se
ejecutaron. Desde entonces:

- El código evolucionó por encima de lo que ese plan describe (ver `ESTADO.md` y `BITACORA.md` en la
  raíz del repo para el estado real y actualizado).
- Algunas de sus afirmaciones ya no son ciertas contra el código de hoy — por ejemplo, describe un
  flujo con `checkout_configuration` en el front que ya cambió (ver `ESTADO.md` §3.0).
- Ese plan **no sabe nada de `producto_planes`, del catálogo agrupado, ni de ninguna de las
  decisiones D1-D8 de `00-PLAN-PANEL-CATALOGO-FUNNELS.md`**, porque es anterior a todo eso. Si algo de
  ese plan viejo contradice a este plan nuevo, **gana este plan nuevo**, siempre, sin excepción.

## Qué hacer si necesitás contexto del checkout base

No vayas a `tasks/checkout-whop/`. Los documentos vivos y actualizados son:

- `README.md` (raíz del repo) — cómo levantar el proyecto y la configuración de Whop.
- `ESTADO.md` (raíz del repo) — qué está hecho, qué falta, y los bugs encontrados con su explicación.
- `BITACORA.md` (raíz del repo) — qué se hizo en cada sesión.
- `00-PLAN-PANEL-CATALOGO-FUNNELS.md` (esta misma carpeta) — el plan de ESTE módulo, que ya resume en
  su §0 ("No se construye") y en sus decisiones D1-D8 todo lo que hace falta saber del checkout
  existente para no romperlo.

Si después de leer esos cuatro documentos sentís que todavía falta algo que solo estaría en
`tasks/checkout-whop/`, es una señal de que `00-PLAN-PANEL-CATALOGO-FUNNELS.md` no lo resumió bien —
**anotalo en su §10 como pregunta abierta**, no vayas a buscarlo en el plan viejo.

## Qué es seguro seguir sin problema

Todo el código fuente real del repo (`lib/`, `app/`, `components/`, `db/migrations/`) sigue siendo la
fuente de verdad de cómo funciona el sistema hoy — leelo siempre que una task te diga que lo leas.
Esta advertencia es exclusivamente sobre la carpeta de planificación vieja `tasks/checkout-whop/`, no
sobre el código que ese plan produjo, que sigue funcionando en producción y no se toca sin que una
task de este módulo lo diga explícitamente.

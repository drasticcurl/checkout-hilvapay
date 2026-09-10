# Handoff — falta solo el DNS de hilvapay

**Contexto en dos líneas:** se deployó un servicio nuevo de checkout (`hilvapay`) en la VPS
`207.244.244.208`. Todo el lado del servidor **ya está hecho y verificado**. Lo único que falta son
**dos registros de DNS en Cloudflare**, zona `hilvanapp.com`.

---

## 1. Lo único que hay que hacer

Zona **`hilvanapp.com`**, dos registros nuevos, idénticos en forma a `panel.hilvanapp.com` que ya
existe:

| Type | Name | Content | Proxy | TTL |
|---|---|---|---|---|
| A | `hilvapay` | `207.244.244.208` | Proxied (naranja) | Auto |
| A | `pay` | `207.244.244.208` | Proxied (naranja) | Auto |

Nada más. No hay que emitir certificados: los certs del origen son **Cloudflare Origin CA con
`*.hilvanapp.com`**, así que los dos hosts nuevos ya quedan cubiertos por el wildcard que la VPS
tiene instalado.

### Dos cosas de la zona que NO hay que cambiar

**El SSL mode tiene que quedar en `Full`, NO en `Full (strict)`.** La zona `infinixapp.com` de esta
misma máquina usa certs self-signed y se cae entera si se pasa a strict. Está documentado en
`/srv/PROYECTOS.md` de la VPS.

**Si hay Bot Fight Mode o alguna regla de WAF activa, hay que exceptuar una ruta.** Whop postea el
webhook de pagos a:

```
https://pay.hilvanapp.com/api/webhooks/whop
```

Si Cloudflare le tira un desafío de bot o un 403, el webhook falla en silencio. Y eso tiene una
consecuencia que no se revierte sola: **Whop deshabilita un endpoint que falla 72 horas seguidas, y
los eventos de ese período no se reenvían nunca.** Si hay protección activa en la zona, agregar una
regla de skip (WAF / Bot Fight) para el path `/api/webhooks/whop` del host `pay.hilvanapp.com`.

El endpoint se autentica solo, con firma HMAC de Standard Webhooks: no necesita la protección de
Cloudflare para ser seguro.

---

## 2. Cómo verificar que quedó bien

Después de propagar, esto tiene que dar exactamente estos códigos:

```bash
# el panel
curl -s -o /dev/null -w '%{http_code}\n' https://hilvapay.hilvanapp.com/          # 200
curl -s -o /dev/null -w '%{http_code}\n' https://hilvapay.hilvanapp.com/admin     # 307 (redirige al login)
curl -s -o /dev/null -w '%{http_code}\n' https://hilvapay.hilvanapp.com/admin/login  # 200

# los links de pago
curl -s -o /dev/null -w '%{http_code}\n' https://pay.hilvanapp.com/loader.js      # 200
curl -s -o /dev/null -w '%{http_code}\n' https://pay.hilvanapp.com/pagos/no-existe # 404

# LA SEPARACIÓN DE DOMINIOS: el panel NO se sirve en el dominio de pago
curl -s -o /dev/null -w '%{http_code}\n' https://pay.hilvanapp.com/admin          # 404, NO 307

# el webhook acepta POST (405 en GET es lo correcto)
curl -s -o /dev/null -w '%{http_code}\n' https://pay.hilvanapp.com/api/webhooks/whop  # 405
curl -s -o /dev/null -w '%{http_code}\n' -X POST -d '{}' \
  https://pay.hilvanapp.com/api/webhooks/whop                                      # 400 (firma inválida)
```

Ese **404 en `pay.hilvanapp.com/admin`** es la verificación que importa: significa que la separación
de dominios funciona y que el dominio que va a estar en anuncios no expone ni la pantalla de login.

Si el webhook con POST devuelve 403 o un HTML de desafío en lugar de 400, es Cloudflare
interceptándolo: ver la nota del WAF de arriba.

---

## 3. Lo que NO hay que tocar

Ya está hecho y funcionando. Tocarlo solo puede romperlo:

- **`/etc/caddy/Caddyfile`** — los dos bloques ya están agregados y validados. Ese archivo tiene
  bloques que no viven en ningún repo (`ritual.hilvanapp.org`, `generador.hilvanapp.online`,
  `gatos.infinixapp.com`, `panel.infinixapp.com`): un `provision.sh` de otro repo los borraría.
  Backups con timestamp en `/etc/caddy/Caddyfile.bak-*`.
- **PM2** — `hilvapay-3020` está online y `pm2 save` ya corrió, así que sobrevive al reboot.
- **El crontab de `deploy`** — la línea de `drenar-salidas.sh` ya está y se confirmó corriendo sola.
- **`/srv/hilvapay/shared/.env.production`** — 13 variables cargadas y verificadas contra la API de
  Whop, chmod 600. Tres quedaron vacías **a propósito** (`PANEL_INGEST_URL`, `PANEL_INGEST_KEY`,
  `RESEND_API_KEY`): son decisiones pendientes del dueño, no un olvido.
- **La base `hilvapay`** — 10 tablas, migraciones aplicadas, las 12 afirmaciones del esquema en
  verde. Está vacía de datos a propósito: el catálogo se carga desde el panel.
- **El puerto 3020** — libre y elegido a propósito. En la máquina están ocupados 3001–3013.

---

## 4. Estado del deploy, para referencia

| | |
|---|---|
| Repo | `github.com/drasticcurl/checkout-hilvapay` (privado, deploy key de solo lectura) |
| Path | `/srv/hilvapay/` con `repo/`, `releases/`, `current`, `shared/` |
| Deploy | `sudo -u deploy bash /srv/hilvapay/repo/deploy/deploy.sh` |
| Proceso | PM2 `hilvapay-3020`, escuchando **solo** en `127.0.0.1:3020` |
| Base | `hilvapay` (+ `hilvapay_test` para los tests del deploy), rol `hilvapay` |
| Credencial de la base | `/root/.hilvapay-db-url` (chmod 600), igual patrón que infinix |
| Cron | `* * * * * /srv/hilvapay/repo/deploy/drenar-salidas.sh`, log en `/var/log/hilvapay/salidas.log` |
| Logs de Caddy | `/var/log/caddy/hilvapay.log` y `/var/log/caddy/pay.log` |

Verificado el 2026-09-10 después del deploy: los 8 sitios que ya andaban siguen respondiendo igual
(`panel.hilvanapp.com` 200, `chauhinchazon` 307, `ritual` 307, `gelatina` 307, `gatos` 307,
`panel.infinixapp.com` 200, `landing` 301, `reset` 307).

---

## 5. Lo que queda para el dueño, no para vos

No es trabajo de infraestructura, va acá solo para que no se pierda:

1. **El webhook en Whop.** Dashboard → Developer → Webhooks → Create, con URL
   `https://pay.hilvanapp.com/api/webhooks/whop`, versión **v1**, eventos `payment.succeeded`,
   `payment.failed`, `refund.created`, `dispute.created`. Probarlo con **Send event**: tiene que dar
   200. El signing secret ya está cargado en el env, así que si se crea un webhook nuevo hay que
   actualizarlo.
2. **Los planes de los upsells** en Whop, tipo `one_time` y atados a un producto.
3. **La primera compra de prueba**, con tarjeta real y reembolso: no hay sandbox configurado, así que
   es la única forma de verificar que Whop guarda el método de pago. Sin eso no hay upsell one-click.

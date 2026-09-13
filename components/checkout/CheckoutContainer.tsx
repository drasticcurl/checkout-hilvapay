'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConfigPagina } from '@/lib/tipos';
import { BadgeSeguro } from './BadgeSeguro';
import { BotonComprar } from './BotonComprar';
import { BotonExpress } from './BotonExpress';
import { CajaTarjeta, type ControlesTarjeta } from './CajaTarjeta';
import { CamposComprador } from './CamposComprador';
import { CardProducto } from './CardProducto';
import { Timer } from './Timer';
import { datosCompletos } from './utils';

type Producto = {
  nombre: string;
  precio: string;
  precioAnclaje: string | null;
  moneda: string;
  imagenUrl: string | null;
  whopPlanId: string;
};

/**
 * Datos de una orden ya existente (modo recuperación, T03 §7): el nombre y el
 * email ya se conocen y no hay que volver a pedirlos.
 */
type OrdenRecuperacion = { ordenId: string; email: string };

export function CheckoutContainer({
  slug,
  producto,
  config,
  environment,
  recuperacion,
}: {
  slug: string;
  producto: Producto;
  config: ConfigPagina;
  environment: 'production' | 'sandbox';
  /** Presente solo en modo recuperación: la orden y el email ya resueltos por el server component. */
  recuperacion: OrdenRecuperacion | null;
}) {
  const esRecuperacion = recuperacion !== null;

  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState(recuperacion?.email ?? '');
  const [sesion, setSesion] = useState<{ ordenId: string; sessionId: string | null; planId: string | null; token: string } | null>(null);
  const [creandoSesion, setCreandoSesion] = useState(false);
  const [embedListo, setEmbedListo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  const [redirigiendo, setRedirigiendo] = useState(false);

  // Doble defensa contra el doble click: el flag síncrono de acá (primera
  // línea) y el índice único de `cobros` del lado de la base (D1, la real).
  const enVueloRef = useRef(false);
  const controlesRef = useRef<ControlesTarjeta | null>(null);

  /**
   * Qué forma de pago se está mostrando en la pantalla de recuperación.
   *
   * Existe para garantizar que haya UNA SOLA surface de Whop montada por vez.
   * Con el wallet y el embed juntos sobre la misma `checkout_configuration`, el
   * pago con Apple Pay no llegaba a crearse (medido el 2026-09-11). En el
   * checkout normal no se usa: ahí el formulario es el único camino.
   */
  const [metodo, setMetodo] = useState<'wallet' | 'tarjeta'>('wallet');

  /**
   * A dónde vuelve el comprador si el wallet usa un método que redirige.
   *
   * Se calcula una sola vez en el cliente y NO con `window.location.href` inline:
   * en el primer render `window` no existe, así que el componente montaba con
   * `returnUrl=''` — y la doc de Whop exige una URL absoluta. Con `useState` +
   * inicializador perezoso el valor se fija en el primer render del cliente y no
   * cambia después, que es lo que el embed espera.
   */
  const [urlDeRetorno] = useState(() =>
    typeof window === 'undefined' ? '' : window.location.href,
  );

  const crearSesion = useCallback(async () => {
    if (creandoSesion || sesion) return;
    setCreandoSesion(true);
    setMensajeError(null);
    try {
      const params = new URLSearchParams(window.location.search);
      const res = await fetch('/api/checkout/sesion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          esRecuperacion
            ? { slug, ordenIdRecuperacion: recuperacion?.ordenId }
            : {
                slug,
                nombre,
                email,
                sessionId: params.get('sessionId') ?? undefined,
                visitorId: params.get('visitorId') ?? undefined,
              },
        ),
      });
      if (!res.ok) {
        setMensajeError('No pudimos iniciar el pago. Recargá la página e intentá de nuevo.');
        return;
      }
      const data = (await res.json()) as { ordenId: string; sessionId: string | null; planId: string | null; token: string };
      setSesion(data);
    } catch {
      setMensajeError('No pudimos conectar con el servidor de pago. Revisá tu conexión.');
    } finally {
      setCreandoSesion(false);
    }
  }, [creandoSesion, sesion, slug, nombre, email, esRecuperacion, recuperacion]);

  const listoParaMostrarEmbed = esRecuperacion || datosCompletos(nombre, email);

  // En modo recuperación la sesión se crea apenas se conoce el email de la
  // orden, sin esperar a que la persona complete ningún campo (D3: es un pago
  // NUEVO sobre la misma orden, no hay nada que reanudar). En modo normal, se
  // crea recién cuando los datos están completos (así no se genera una orden
  // por cada tecla). El efecto es la forma correcta de disparar esto: hacerlo
  // durante el render duplicaría la llamada en Strict Mode.
  useEffect(() => {
    if (listoParaMostrarEmbed && !sesion && !creandoSesion) {
      void crearSesion();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- crearSesion ya
    // incluye sus propias dependencias; re-ejecutar solo cuando cambia si hay
    // que crear la sesión evita el loop de "crearSesion cambia → efecto corre
    // → crearSesion vuelve a cambiar".
  }, [listoParaMostrarEmbed, sesion, creandoSesion]);

  const handleCompletado = useCallback(
    async (receiptId: string) => {
      if (!sesion) return;
      setEnviando(true);
      setMensajeError(null);
      try {
        const res = await fetch('/api/checkout/reclamar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ordenId: sesion.ordenId,
            receiptId,
            ...(esRecuperacion ? { slugPaginaActual: slug } : {}),
          }),
        });
        const data = (await res.json()) as { ok: boolean; siguienteUrl?: string | null };
        if (data.ok && data.siguienteUrl) {
          setRedirigiendo(true);
          window.location.href = data.siguienteUrl;
          return;
        }
        if (data.ok) {
          // Pagado pero sin url_exito configurada: no hay a dónde mandarla.
          setMensajeError('¡Listo! Tu pago se acreditó correctamente.');
          return;
        }
        // ok:false → el webhook todavía va a resolverlo; no es un error del
        // comprador.
        setMensajeError('Estamos confirmando tu pago. Esto puede tardar unos segundos.');
      } catch {
        setMensajeError('Tu pago puede haberse procesado. Si no ves confirmación, contactanos.');
      } finally {
        setEnviando(false);
      }
    },
    // `esRecuperacion` y `slug` van en las deps aunque en la práctica no cambien
    // durante la vida del componente: `slug` es una prop del server component y
    // `esRecuperacion` se deriva de otra. Estaban omitidas y el efecto es nulo
    // hoy, pero una dep faltante es una trampa cargada — el día que alguien haga
    // que el checkout cambie de paso sin remontar, este handler seguiría
    // reclamando contra el slug viejo. Detectado en la auditoría del 2026-09-11.
    [sesion, esRecuperacion, slug],
  );

  const handleClickComprar = useCallback(() => {
    if (enVueloRef.current) return;
    enVueloRef.current = true;
    setEnviando(true);
    controlesRef
      .current?.submit()
      .catch(() => {
        setMensajeError('No pudimos procesar el pago. Revisá los datos de la tarjeta.');
      })
      .finally(() => {
        enVueloRef.current = false;
        setEnviando(false);
      });
  }, []);

  const botonHabilitado = embedListo && listoParaMostrarEmbed && !!sesion && !redirigiendo;

  return (
    <div className="mx-auto w-full max-w-checkout">
      {config.timerMinutos ? <Timer minutos={config.timerMinutos} /> : null}
      {config.badgeSeguro !== false ? <BadgeSeguro /> : null}

      <div className="flex flex-col gap-5 px-4 pb-8 pt-5">
        <CardProducto
          nombre={producto.nombre}
          imagenUrl={producto.imagenUrl}
          precio={producto.precio}
          precioAnclaje={producto.precioAnclaje}
          moneda={producto.moneda}
          subtitulo={config.subtitulo}
        />

        {esRecuperacion ? (
          <p className="rounded-lg border border-precio/25 bg-precio/5 px-3.5 py-3 text-[13px] leading-relaxed text-texto">
            Tu banco necesita que confirmes esta compra. Terminala acá abajo, es un solo paso.
          </p>
        ) : (
          <CamposComprador nombre={nombre} email={email} onNombreChange={setNombre} onEmailChange={setEmail} />
        )}

        {/* ── UNA SOLA SURFACE DE WHOP POR VEZ ──────────────────────────────
            En recuperación se ofrece primero el wallet y el formulario de
            tarjeta SOLO si el comprador lo pide. Nunca los dos juntos, y esa es
            la corrección de un bug medido:

            La primera versión montaba `BotonExpress` y `CajaTarjeta` a la vez,
            los dos sobre la MISMA `checkout_configuration`. Probado con Apple Pay
            real el 2026-09-11: la hoja se abría, el comprador la aprobaba, volvía
            a la página y NO se creaba ningún pago en Whop (verificado en
            `GET /payments`: el último seguía siendo el del front). Dos embeds de
            Whop peleándose la misma sesión.

            El wallet acá tiene sentido porque el comprador ESTÁ PRESENTE y puede
            autenticarse. Lo que el wallet no arregla es el cobro off-session del
            paso siguiente: un token de Apple Pay es un DPAN atado al dispositivo,
            sin fingerprint ni expiración (medido: `payt_6LXxXQSekTbrs` los trae en
            null), y por diseño no se puede cobrar sin el titular. */}
        {esRecuperacion && metodo === 'wallet' ? (
          <div className="flex flex-col gap-3">
            {sesion ? (
              <BotonExpress
                sessionId={sesion.sessionId ?? ''}
                returnUrl={urlDeRetorno}
                email={email}
                environment={environment}
                onCompletado={handleCompletado}
                onError={setMensajeError}
                onEvento={(e) => {
                  // Si el navegador no soporta ningún wallet, se pasa solo al
                  // formulario: dejar la pantalla sin ninguna forma de pagar es
                  // peor que mostrar el formulario sin preguntar.
                  if (e.tipo === 'metodo' && e.rendered === 'none') setMetodo('tarjeta');
                }}
              />
            ) : (
              <div className="flex h-11 items-center justify-center">
                <span
                  className="h-5 w-5 animate-spin rounded-full border-2 border-borde border-t-precio"
                  role="status"
                  aria-label="Cargando las formas de pago"
                />
              </div>
            )}
            <button
              type="button"
              onClick={() => setMetodo('tarjeta')}
              className="text-center text-[13px] text-texto-2 underline underline-offset-2 hover:text-texto"
            >
              Prefiero pagar con tarjeta
            </button>
          </div>
        ) : null}

        {/* El formulario. En recuperación solo aparece si el comprador eligió
            tarjeta o si no había wallet disponible; en el checkout normal es
            siempre el único camino. */}
        {(!esRecuperacion || metodo === 'tarjeta') && listoParaMostrarEmbed && sesion ? (
          <CajaTarjeta
            ref={controlesRef}
            sessionId={sesion.sessionId}
            planId={sesion.planId ?? producto.whopPlanId}
            email={email}
            environment={environment}
            onReady={setEmbedListo}
            onCompletado={handleCompletado}
            onError={(msg) => setMensajeError(msg)}
          />
        ) : !esRecuperacion || metodo === 'tarjeta' ? (
          // El esqueleto que se ve mientras faltan datos: MISMA caja que va a
          // tener el embed —mismo borde de 2px, mismo padding, mismo radio— para
          // que al montarse no salte el layout.
          <div className="whop-checkout-wrapper rounded-lg border-2 border-precio px-3.5 py-3">
            <div className="flex h-32 items-center justify-center">
              <span
                className="h-6 w-6 animate-spin rounded-full border-2 border-borde border-t-precio"
                role="status"
                aria-label="Completá tus datos para continuar"
              />
            </div>
          </div>
        ) : null}

        {mensajeError ? (
          <p
            className="rounded-lg border border-urgencia/25 bg-urgencia/5 px-3.5 py-3 text-[13px] leading-relaxed text-urgencia"
            role="alert"
          >
            {mensajeError}
          </p>
        ) : null}

        {/* El botón grande solo cuando está montado el EMBED, porque es lo único
            que dispara: `handleClickComprar` llama a `controlesRef.current.submit()`,
            que es el submit del iframe de Whop.

            Con el wallet visible el embed no está montado, así que este botón no
            haría nada — un botón de "COMPRAR AHORA" que no responde en una pantalla
            de pago es peor que no tenerlo, y es exactamente lo que puede haber
            apretado quien probó Apple Pay el 2026-09-11 y reportó que "no pasaba
            nada". El wallet trae su propio botón adentro. */}
        {!esRecuperacion || metodo === 'tarjeta' ? (
          <BotonComprar
            texto={config.textoBoton ?? 'COMPRAR AHORA'}
            disabled={!botonHabilitado}
            cargando={enviando || redirigiendo}
            onClick={handleClickComprar}
          />
        ) : null}

        {/* Va como texto y NO como links: no existen esas páginas todavía, y un
            link roto en un checkout es peor que no tenerlo. Los términos que sí
            aplican al cobro los muestra el embed de Whop adentro del iframe
            (`hideTermsAndConditions` en false, que es donde vive el
            consentimiento para guardar la tarjeta).

            En la referencia este texto es casi invisible (gris ~2.5:1). Acá va en
            `texto-suave` (4.8:1): es la letra chica de una compra, y letra chica
            de una compra que no se puede leer es un problema legal, no una
            decisión de diseño. Sigue siendo lo más tenue de la página. */}
        <p className="mt-8 text-center text-[11px] leading-relaxed text-texto-suave">
          Al concluir tu compra, aceptás los Términos de Uso y la Política de Privacidad.
        </p>
      </div>
    </div>
  );
}

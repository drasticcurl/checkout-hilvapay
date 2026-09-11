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
  const [sesion, setSesion] = useState<{ ordenId: string; sessionId: string; token: string } | null>(null);
  const [creandoSesion, setCreandoSesion] = useState(false);
  const [embedListo, setEmbedListo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  const [redirigiendo, setRedirigiendo] = useState(false);

  // Doble defensa contra el doble click: el flag síncrono de acá (primera
  // línea) y el índice único de `cobros` del lado de la base (D1, la real).
  const enVueloRef = useRef(false);
  const controlesRef = useRef<ControlesTarjeta | null>(null);

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
      const data = (await res.json()) as { ordenId: string; sessionId: string; token: string };
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
            Tu banco necesita que confirmes esta compra. Ingresá los datos de tu tarjeta una vez más para completarla.
          </p>
        ) : (
          <CamposComprador nombre={nombre} email={email} onNombreChange={setNombre} onEmailChange={setEmail} />
        )}

        {/* El wallet SOLO en recuperación, y arriba de la caja de tarjeta.
            Acá el comprador ya dijo que sí y el cobro falló: pedirle que tipee
            de nuevo los 16 dígitos es la fricción máxima en el peor momento. Con
            Apple Pay o Google Pay aprueba con Face ID y el wallet resuelve el
            desafío del banco solo — que es exactamente lo que el cobro
            off-session no puede hacer.

            No se pone en el checkout del front a propósito: ahí el embed ya
            funciona, cobra y guarda la tarjeta, y agregar una segunda forma de
            pagar arriba del formulario es una decisión de conversión que
            merece medirse aparte, no colarse en un arreglo de recuperación. */}
        {esRecuperacion && sesion ? (
          <BotonExpress
            sessionId={sesion.sessionId}
            email={email}
            environment={environment}
            onCompletado={handleCompletado}
            onError={setMensajeError}
          />
        ) : null}

        {listoParaMostrarEmbed && sesion ? (
          <CajaTarjeta
            ref={controlesRef}
            sessionId={sesion.sessionId}
            planId={producto.whopPlanId}
            email={email}
            environment={environment}
            onReady={setEmbedListo}
            onCompletado={handleCompletado}
            onError={(msg) => setMensajeError(msg)}
          />
        ) : (
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
        )}

        {mensajeError ? (
          <p
            className="rounded-lg border border-urgencia/25 bg-urgencia/5 px-3.5 py-3 text-[13px] leading-relaxed text-urgencia"
            role="alert"
          >
            {mensajeError}
          </p>
        ) : null}

        <BotonComprar
          texto={config.textoBoton ?? 'COMPRAR AHORA'}
          disabled={!botonHabilitado}
          cargando={enviando || redirigiendo}
          onClick={handleClickComprar}
        />

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

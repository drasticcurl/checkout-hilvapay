/**
 * Primitivas del panel. Sin hooks y sin `'use client'`: son puro markup, así que
 * sirven igual en server components y adentro de componentes cliente.
 *
 * No aceptan iconos importados desde acá — los recibe como `ReactNode`. Es lo
 * que mantiene este archivo neutral respecto de la frontera RSC: cada pantalla
 * importa sus iconos de `@phosphor-icons/react/ssr` por su cuenta.
 *
 * Reglas del sistema, aplicadas en todas las primitivas:
 *   · radios     → contenedores 12px (`rounded-card`), controles 8px
 *                  (`rounded-ctrl`), micro 6px (`rounded-micro`), toggles pill.
 *   · color      → acción primaria en `tinta` (casi negro), `acento` para
 *                  interactivo, `vivo` solo para "está cobrando", `peligro` solo
 *                  para destructivo.
 *   · movimiento → 150ms sobre transform/color/sombra y nada más. Todo colapsa
 *                  con `prefers-reduced-motion` desde globals.css.
 */
import type { ReactNode } from 'react';

export function unir(...clases: Array<string | false | null | undefined>): string {
  return clases.filter(Boolean).join(' ');
}

/* ─────────────────────────────── Botón ─────────────────────────────── */

type VarianteBoton = 'primario' | 'secundario' | 'fantasma' | 'peligro' | 'vivo';
type TamanoBoton = 'sm' | 'md' | 'lg';

const BASE_BOTON =
  // `whitespace-nowrap`: la etiqueta de un botón no se parte en dos líneas nunca.
  // `active:translate-y-px`: el empujón físico que hace que se sienta apretado.
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-ctrl font-medium ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ' +
  'active:translate-y-px disabled:pointer-events-none disabled:opacity-45';

const VARIANTES_BOTON: Record<VarianteBoton, string> = {
  // Antes `bg-tinta` (casi negro, en el modo claro). Con el panel a dark
  // (sesión 2026-09-15) `tinta` pasó a ser la escala de TEXTO, invertida a casi
  // blanca — usarla como fondo de botón con `text-white` encima se rompería
  // (texto blanco sobre fondo casi blanco). La acción primaria pasa al acento:
  // es el patrón estándar de un dark UI, y es consistente con que el resto de
  // los acentos (vivo/peligro) ya usan su propio `oscuro` como fondo de botón.
  primario: 'bg-acento-oscuro text-white shadow-sombra hover:bg-acento-hover',
  secundario:
    'border border-panel-bordeFuerte bg-panel-sup text-tinta shadow-sombra hover:border-tinta-4 hover:bg-panel-sup2',
  fantasma: 'text-tinta-2 hover:bg-panel-sup2 hover:text-tinta',
  // El anillo de foco del panel (globals.css, `[data-panel-dark]`) sirve para
  // los cinco, incluso para el rojo y el verde: va con `outline-offset: 2px`,
  // así que cae sobre el fondo de la tarjeta y no sobre el relleno del botón.
  peligro: 'bg-peligro-oscuro text-white shadow-sombra hover:bg-peligro-hover',
  vivo: 'bg-vivo-oscuro text-white shadow-sombra hover:bg-vivo-hover',
};

const TAMANOS_BOTON: Record<TamanoBoton, string> = {
  sm: 'h-8 px-2.5 text-[13px]',
  md: 'h-9 px-3.5 text-sm',
  lg: 'h-10 px-4 text-sm',
};

export function clasesBoton(
  variante: VarianteBoton = 'primario',
  tamano: TamanoBoton = 'md',
  extra?: string,
): string {
  return unir(BASE_BOTON, VARIANTES_BOTON[variante], TAMANOS_BOTON[tamano], extra);
}

export function Boton({
  variante = 'primario',
  tamano = 'md',
  icono,
  children,
  className,
  ...props
}: {
  variante?: VarianteBoton;
  tamano?: TamanoBoton;
  icono?: ReactNode;
  children?: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button type="button" className={clasesBoton(variante, tamano, className)} {...props}>
      {icono}
      {children}
    </button>
  );
}

/* ─────────────────────────── Campos de formulario ─────────────────────────── */

/**
 * El input, el select y el textarea comparten estas clases para que el foco, el
 * hover y el alto sean el mismo en los tres. El halo (`ring-4` al 10%) reemplaza
 * al outline global, que en un campo de texto aparecía también al hacer click.
 *
 * El texto deshabilitado va en `tinta-2` y no en `tinta-3`: sobre `panel-sup2`,
 * `tinta-3` da 4.40:1 y se queda corto del 4.5:1 de AA. Que "deshabilitado" se
 * entienda ya lo dicen el fondo gris y el cursor; no hace falta además volver el
 * valor difícil de leer, y en un campo deshabilitado el valor sigue siendo
 * información que hay que poder leer.
 */
export const CONTROL_BASE =
  'w-full rounded-ctrl border border-panel-bordeFuerte bg-panel-sup text-sm text-tinta ' +
  'placeholder:text-tinta-3 transition-[border-color,box-shadow] duration-150 ' +
  'hover:border-tinta-4 focus:border-acento focus:outline-none focus:ring-4 focus:ring-acento/10 ' +
  'disabled:cursor-not-allowed disabled:bg-panel-sup2 disabled:text-tinta-2';

/**
 * El alto va como parámetro y NO como clase extra por una razón concreta: dos
 * utilidades de alto en el mismo elemento (`h-9` y `h-10`) tienen la misma
 * especificidad, así que gana la que Tailwind haya puesto más abajo en la hoja
 * de estilos, no la que va última en el atributo `class`. Eso hace que el alto
 * del campo dependa del orden interno del build, que es un lugar horrible para
 * que viva una decisión de diseño.
 *
 *   md   → 36px, el default de las tablas y los formularios densos
 *   lg   → 40px, para el campo protagonista de una pantalla (login, nombre)
 *   auto → sin alto fijo, para `<textarea>`
 */
type AltoControl = 'md' | 'lg' | 'auto';

const ALTOS_CONTROL: Record<AltoControl, string> = {
  md: 'h-9 px-3',
  lg: 'h-10 px-3.5',
  auto: 'px-3 py-2',
};

export function clasesControl(extra?: string, alto: AltoControl = 'md'): string {
  return unir(CONTROL_BASE, ALTOS_CONTROL[alto], extra);
}

/**
 * Bloque de campo: etiqueta ARRIBA del control, ayuda abajo, error abajo del
 * todo. Nunca placeholder como etiqueta — un placeholder desaparece cuando se
 * empieza a escribir y deja el campo sin nombre.
 *
 * `error` reemplaza a `ayuda` en pantalla pero el markup de la ayuda no cambia
 * de lugar, así que el layout no salta cuando aparece el error.
 */
export function Campo({
  etiqueta,
  htmlFor,
  ayuda,
  error,
  opcional,
  children,
  className,
}: {
  etiqueta: string;
  htmlFor?: string;
  ayuda?: ReactNode;
  error?: string | null;
  opcional?: boolean;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={unir('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="flex items-baseline gap-1.5 text-[13px] font-medium text-tinta">
        {etiqueta}
        {opcional ? <span className="text-[12px] font-normal text-tinta-3">opcional</span> : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-[12px] font-medium text-peligro">
          {error}
        </p>
      ) : ayuda ? (
        <p className="text-[12px] leading-relaxed text-tinta-3">{ayuda}</p>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────── Superficies ─────────────────────────────── */

export function Tarjeta({
  children,
  className,
  ...props
}: { children: ReactNode } & React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={unir('rounded-card border border-panel-borde bg-panel-sup shadow-sombra', className)}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Encabezado de pantalla. El título va en 20px semibold con tracking negativo:
 * el peso y el color dan la jerarquía, no el tamaño bruto.
 */
export function EncabezadoPantalla({
  titulo,
  descripcion,
  acciones,
}: {
  titulo: string;
  descripcion?: ReactNode;
  acciones?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-tinta">{titulo}</h1>
        {descripcion ? (
          <p className="max-w-[65ch] text-sm leading-relaxed text-tinta-2">{descripcion}</p>
        ) : null}
      </div>
      {acciones ? <div className="flex shrink-0 items-center gap-2">{acciones}</div> : null}
    </div>
  );
}

/* ─────────────────────────────── Insignias ─────────────────────────────── */

type TonoInsignia = 'neutro' | 'vivo' | 'peligro' | 'acento' | 'alerta';

const TONOS_INSIGNIA: Record<TonoInsignia, string> = {
  neutro: 'border-panel-bordeFuerte bg-panel-sup2 text-tinta-2',
  // El texto de cada tono usa el `DEFAULT` de su acento (brillante), no
  // `*-oscuro` (pensado para fondo de botón sólido con texto blanco encima).
  // Verificado con contraste real (sesión 2026-09-15): `oscuro` sobre `suave`
  // da 2.9-3.3:1 y NO pasa AA; `DEFAULT` sobre el mismo `suave` da 5.8-8.8:1.
  vivo: 'border-vivo-borde bg-vivo-suave text-vivo',
  peligro: 'border-peligro-borde bg-peligro-suave text-peligro',
  acento: 'border-acento-borde bg-acento-suave text-acento',
  alerta: 'border-alerta-borde bg-alerta-suave text-alerta',
};

/**
 * Insignia cuadrada, no pastilla: la pastilla es el default de todos los paneles
 * generados y acá hay muchas juntas en las tablas, donde el rectángulo lee más
 * ordenado contra la grilla.
 */
export function Insignia({
  tono = 'neutro',
  icono,
  children,
  className,
}: {
  tono?: TonoInsignia;
  icono?: ReactNode;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <span
      className={unir(
        'inline-flex items-center gap-1 rounded-micro border px-1.5 py-0.5 text-[11px] font-medium',
        TONOS_INSIGNIA[tono],
        className,
      )}
    >
      {icono}
      {children}
    </span>
  );
}

/**
 * Estado de un link, un producto o un funnel. Acá el punto de color SÍ está
 * justificado: comunica un estado real y consecuente — si está en verde, ese
 * link está cobrando tarjetas ahora mismo. No es decoración.
 */
export function EstadoVivo({ activo, className }: { activo: boolean; className?: string }): JSX.Element {
  return (
    <span
      className={unir(
        'inline-flex items-center gap-1.5 text-[12px] font-medium',
        activo ? 'text-vivo' : 'text-tinta-3',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={unir('h-1.5 w-1.5 rounded-full', activo ? 'bg-vivo' : 'bg-tinta-4')}
      />
      {activo ? 'Cobrando' : 'Apagado'}
    </span>
  );
}

/** Un id de Whop, un slug, una URL. Monoespaciada y con fondo apenas marcado. */
export function Codigo({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <code
      className={unir(
        'rounded-micro bg-panel-sup2 px-1.5 py-0.5 font-mono text-[12px] text-tinta-2',
        className,
      )}
    >
      {children}
    </code>
  );
}

/**
 * Marcador de "acá no hay valor". Un guion común y no una raya larga (—), que es
 * el tic tipográfico que se colaba en todas las celdas vacías.
 *
 * Y un valor que no se puede calcular se muestra así, nunca con un cero: un
 * cobro sin monto todavía no es un cobro de $0.
 *
 * El `aria-label` existe porque un lector de pantalla leyendo "guion" en veinte
 * celdas seguidas no dice nada; "sin dato" sí.
 */
export function SinDato(): JSX.Element {
  return (
    <span className="text-tinta-3" aria-label="sin dato">
      -
    </span>
  );
}

/* ─────────────────────────────── Tablas ─────────────────────────────── */

/**
 * `overflow-x-auto` fuerza también `overflow-y: auto` por especificación, así que
 * el contenedor ya es un contexto de scroll. Sin altura máxima nunca scrollea en
 * vertical y la cabecera `sticky` no tiene contra qué pegarse. `conAltura` le
 * pone el techo: es lo que hace que en `/admin/cobros`, con 100 filas, se sepa
 * siempre qué columna se está leyendo.
 */
export function TablaEnvoltorio({
  children,
  className,
  conAltura,
}: {
  children: ReactNode;
  className?: string;
  conAltura?: boolean;
}): JSX.Element {
  return (
    <div
      className={unir(
        'overflow-auto rounded-card border border-panel-borde bg-panel-sup shadow-sombra',
        conAltura && 'max-h-[min(70dvh,44rem)]',
        className,
      )}
    >
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

/**
 * Cabecera de tabla en 11px mayúsculas con tracking: es la única mayúscula
 * chica del panel y no se usa como etiqueta decorativa arriba de los títulos.
 * `sticky` para que en las listas largas (cobros trae 100 filas) no haya que
 * volver a scrollear arriba para saber qué columna se está leyendo.
 */
export function Th({
  children,
  className,
  numerica,
}: {
  children?: ReactNode;
  className?: string;
  numerica?: boolean;
}): JSX.Element {
  return (
    <th
      scope="col"
      className={unir(
        'sticky top-0 z-10 whitespace-nowrap border-b border-panel-borde bg-panel-sup2/95 px-4 py-2.5',
        'text-[11px] font-medium uppercase tracking-[0.06em] text-tinta-3 backdrop-blur',
        numerica && 'text-right',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  numerica,
}: {
  children?: ReactNode;
  className?: string;
  numerica?: boolean;
}): JSX.Element {
  return (
    <td
      className={unir(
        'px-4 py-3 align-middle text-tinta',
        numerica && 'text-right font-mono tabular-nums',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Tr({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <tr
      className={unir(
        'border-b border-panel-borde transition-colors last:border-0 hover:bg-panel-sup2/60',
        className,
      )}
    >
      {children}
    </tr>
  );
}

/* ─────────────────────────── Controles compuestos ─────────────────────────── */

/**
 * Interruptor controlado para formularios. Es un `<button role="switch">` y no un
 * div con onClick: así responde a Espacio y Enter, y un lector de pantalla dice
 * si está activado.
 *
 * Distinto de `SwitchActivo`: ese pega un PATCH y pide confirmación para
 * encender. Este solo mueve estado local del formulario.
 */
export function Interruptor({
  id,
  activo,
  onCambiar,
  etiquetaAccesible,
}: {
  id?: string;
  activo: boolean;
  onCambiar: (valor: boolean) => void;
  etiquetaAccesible: string;
}): JSX.Element {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={activo}
      onClick={() => onCambiar(!activo)}
      className={unir(
        'relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full',
        'transition-[background-color] duration-200',
        activo ? 'bg-acento' : 'bg-panel-sup3 hover:bg-tinta-4',
      )}
    >
      <span className="sr-only">{etiquetaAccesible}</span>
      <span
        className={unir(
          'inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sombra transition-transform duration-200',
          activo ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

/**
 * Opción de radio con forma de tarjeta seleccionable. El `<input>` sigue ahí,
 * nativo y navegable con flechas; solo se lo saca de la vista y se dibuja el
 * estado con `peer-checked`. El anillo de foco viaja al recuadro visible con
 * `peer-focus-visible`, así que no se pierde navegando con teclado.
 */
export function OpcionRadio({
  name,
  value,
  checked,
  onChange,
  titulo,
  descripcion,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  titulo: string;
  descripcion?: string;
}): JSX.Element {
  return (
    <label className="flex-1 cursor-pointer">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="peer sr-only"
      />
      <span
        className={unir(
          'block h-full rounded-ctrl border px-3 py-2.5 transition-[border-color,background-color] duration-150',
          'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
          'peer-focus-visible:outline-acento',
          checked
            ? 'border-acento bg-acento-suave'
            : 'border-panel-bordeFuerte bg-panel-sup hover:border-tinta-4',
        )}
      >
        <span
          className={unir('block text-[13px] font-medium', checked ? 'text-acento' : 'text-tinta')}
        >
          {titulo}
        </span>
        {descripcion ? (
          <span className="mt-0.5 block text-[12px] leading-relaxed text-tinta-3">{descripcion}</span>
        ) : null}
      </span>
    </label>
  );
}

/* ─────────────────────────────── Estados ─────────────────────────────── */

/**
 * Estado vacío compuesto: icono, una frase que dice qué falta, y la acción que
 * lo resuelve. Una lista vacía con "Todavía no hay nada" es una pantalla que no
 * ayuda a salir de ahí.
 */
export function EstadoVacio({
  icono,
  titulo,
  descripcion,
  accion,
}: {
  icono: ReactNode;
  titulo: string;
  descripcion: ReactNode;
  accion?: ReactNode;
}): JSX.Element {
  return (
    <div className="rounded-card border border-dashed border-panel-bordeFuerte bg-panel-sup px-6 py-12 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-ctrl border border-panel-borde bg-panel-sup2 text-tinta-3">
        {icono}
      </div>
      <p className="mt-4 text-sm font-medium text-tinta">{titulo}</p>
      <p className="mx-auto mt-1.5 max-w-[46ch] text-[13px] leading-relaxed text-tinta-2">{descripcion}</p>
      {accion ? <div className="mt-5 flex justify-center">{accion}</div> : null}
    </div>
  );
}

type TonoAviso = 'peligro' | 'alerta' | 'acento' | 'vivo';

const TONOS_AVISO: Record<TonoAviso, string> = {
  // Mismo criterio que TONOS_INSIGNIA: DEFAULT (brillante) como texto, nunca
  // `*-oscuro` (pensado para fondo de botón sólido con texto blanco).
  peligro: 'border-peligro-borde bg-peligro-suave text-peligro',
  alerta: 'border-alerta-borde bg-alerta-suave text-alerta',
  acento: 'border-acento-borde bg-acento-suave text-acento',
  vivo: 'border-vivo-borde bg-vivo-suave text-vivo',
};

/** Aviso en línea: errores de formulario, advertencias de precio, avisos de estado. */
export function Aviso({
  tono = 'alerta',
  icono,
  titulo,
  children,
  className,
  rol,
}: {
  tono?: TonoAviso;
  icono?: ReactNode;
  titulo?: string;
  children?: ReactNode;
  className?: string;
  rol?: 'alert' | 'status';
}): JSX.Element {
  return (
    <div role={rol} className={unir('rounded-ctrl border px-3.5 py-3', TONOS_AVISO[tono], className)}>
      <div className="flex gap-2.5">
        {icono ? <span className="mt-px shrink-0">{icono}</span> : null}
        <div className="min-w-0 space-y-1">
          {titulo ? <p className="text-[13px] font-semibold">{titulo}</p> : null}
          {children ? <div className="text-[13px] leading-relaxed">{children}</div> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Bloque de carga con la forma de lo que va a llegar, no un spinner circular: el
 * ojo ya sabe dónde mirar cuando aparece el contenido real. El brillo es la
 * única animación en bucle del panel y colapsa con `prefers-reduced-motion`.
 */
export function Esqueleto({ className }: { className?: string }): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={unir('relative overflow-hidden rounded-micro bg-panel-sup2', className)}
    >
      <div className="absolute inset-0 -translate-x-full animate-brillo bg-gradient-to-r from-transparent via-white/70 to-transparent" />
    </div>
  );
}

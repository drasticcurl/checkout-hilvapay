import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pago seguro',
  // Ninguna página de este dominio se indexa: son links de pago que dependen de
  // una orden viva.
  robots: { index: false, follow: false },
};

// SIN esto, Next no manda ningún <meta name="viewport">, y el browser en un
// celular renderiza asumiendo un ancho de escritorio (~980px) y escala TODA
// la página para que entre — el sitio se ve diminuto y nada de lo que haga
// el CSS con max-w/flex/etc. importa, porque el viewport real que el browser
// usa para layout nunca fue el ancho de la pantalla. Es la causa #1 de "esto
// no es responsive" en mobile, separada de cualquier media query.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/**
 * Geist viene del paquete `geist` de Vercel: los archivos se sirven desde el
 * propio build, sin pedirle nada a fonts.googleapis.com. En un checkout eso
 * importa dos veces — un request menos antes del primer render, y ningún
 * tercero enterándose de quién está por pagar.
 *
 * La mono no es un lujo: los ids de Whop, los slugs y las columnas de dinero del
 * panel se leen en monoespaciada, y `tabular-nums` evita que los números bailen
 * al cambiar de dígito.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-white font-sans text-texto antialiased">{children}</body>
    </html>
  );
}

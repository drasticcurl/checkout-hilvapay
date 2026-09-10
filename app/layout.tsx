import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pago seguro',
  // Ninguna página de este dominio se indexa: son links de pago que dependen de
  // una orden viva.
  robots: { index: false, follow: false },
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

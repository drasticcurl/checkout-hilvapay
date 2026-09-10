/**
 * `output: 'standalone'` es obligatorio para el deploy: la app corre con PM2 +
 * Next standalone + Caddy en la VPS, igual que el panel y los funnels. Sin el
 * build autocontenido, PM2 tendría que arrancar `next start` con el
 * `node_modules` completo.
 *
 * `poweredByHeader: false` porque este servicio son dos subdominios públicos que
 * manejan pagos: no tienen por qué anunciar el stack en cada respuesta.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,

  async headers() {
    return [
      {
        // Las páginas de pago no se indexan ni se cachean: cada una depende de
        // una orden y de un embed vivo de Whop. Caddy además pone su propio
        // `no-store` (ver deploy/Caddyfile.hilvapay); esto cubre el caso de
        // acceder al proceso sin pasar por el proxy.
        source: '/pagos/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        // El loader que embeben los funnels vive en otro dominio, así que
        // necesita CORS abierto para el GET del script. El script en sí no
        // expone datos: lee el token de la URL y postea a /api/upsell, que SÍ
        // valida el origen contra la tabla `origenes`.
        source: '/loader.js',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=300' },
        ],
      },
    ];
  },
};

export default nextConfig;

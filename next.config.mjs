/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Las páginas de pago no se indexan ni se guardan en caché de CDN: cada una
  // depende de una orden y de un embed vivo de Whop. El `X-Robots-Tag` va acá y
  // no en cada page porque también tiene que cubrir las rutas de API.
  async headers() {
    return [
      {
        source: '/pagos/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        // El loader que embeben los funnels vive en otro dominio, así que
        // necesita CORS abierto para el GET del script. El script en sí no
        // expone datos: solo lee el token de la URL y postea a /api/upsell.
        source: '/loader.js',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=300' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
    ];
  },
};

export default nextConfig;

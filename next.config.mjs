/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    typedRoutes: true,
    serverComponentsExternalPackages: [
      '@react-pdf/renderer',
      'exceljs',
      'pino',
      'pino-pretty',
    ],
  },
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
  async redirects() {
    return [
      {
        source: '/analise/relatorios/por-profissional',
        destination: '/analise/repasse-medico/por-profissional',
        permanent: true,
      },
      {
        source: '/analise/relatorios/por-profissional/:path*',
        destination: '/analise/repasse-medico/por-profissional/:path*',
        permanent: true,
      },
    ]
  },
}

export default config

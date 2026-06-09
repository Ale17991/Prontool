/**
 * Base URL pública do app, com **esquema garantido**.
 *
 * Lê `NEXT_PUBLIC_APP_URL`. Se a env vier sem esquema (ex.: `clinnipro.com.br`),
 * prefixa `https://` — caso contrário um `href={baseUrl}/paciente/x` vira
 * caminho RELATIVO no navegador e quebra (404 em `/configuracoes/clinnipro.com.br/...`).
 * Fallback de dev: `http://localhost:3000`.
 *
 * NB: `NEXT_PUBLIC_*` é inlined em build — mudar a env exige novo deploy.
 */
export function resolvePublicBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!raw) return 'http://localhost:3000'
  const noTrailing = raw.replace(/\/+$/, '')
  return /^https?:\/\//i.test(noTrailing) ? noTrailing : `https://${noTrailing}`
}

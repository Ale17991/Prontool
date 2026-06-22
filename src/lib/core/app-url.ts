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

/**
 * Origem real a partir dos headers da requisição (runtime), com fallback para
 * `resolvePublicBaseUrl()`. Usar quando o link PRECISA bater com o domínio que o
 * usuário acessou (ex.: e-mail de recuperação de senha), sem depender de
 * `NEXT_PUBLIC_APP_URL` estar setada no build da Vercel.
 */
export function originFromHeaders(headers: { get(name: string): string | null }): string {
  const host = headers.get('x-forwarded-host') ?? headers.get('host')
  if (!host) return resolvePublicBaseUrl()
  const proto = headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

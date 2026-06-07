/**
 * Mock HTTP standalone da API Memed (spec 027, contracts/memed-mock.md).
 *
 * Substitui `api.memed.com.br` nos testes E2E por respostas determinísticas.
 * O dev server Next aponta para cá via `MEMED_BASE_URL=http://localhost:4001`
 * (override no client da cápsula). Também serve o SDK stub e o iframe stub
 * usados pelo Playwright no lugar do módulo Sinapse real.
 *
 * Endpoints da "Memed":
 *   POST  /sinapse-prescricao/usuarios            → cadastra prescritor (422 se faltar campo)
 *   PATCH /sinapse-prescricao/usuarios/{id}       → atualiza prescritor (404 se desconhecido)
 *   GET   /sinapse-prescricao/usuarios/{id}       → token do prescritor (404 se desconhecido)
 *   GET   /especialidades                          → catálogo fixo (5 itens)
 *
 * Endpoints de teste (não existem na Memed real):
 *   GET   /__health                                → 200 (webServer readiness)
 *   POST  /__reset                                 → limpa o estado
 *   POST  /__register                              → pré-registra um external_id (seed)
 *   GET   /iframe-stub.html, /sdk-stub.js          → estáticos de tests/mocks/
 *
 * Conformidade: valida que `api-key`/`secret-key` chegaram na query string
 * (como o client envia) — request sem elas é 400. NUNCA loga os valores.
 *
 * Uso: pnpm tsx tests/mocks/memed-mock-server.ts --port 4001
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))

const PORT = (() => {
  const idx = process.argv.indexOf('--port')
  const raw = idx >= 0 ? process.argv[idx + 1] : process.env.MEMED_MOCK_PORT
  const n = raw ? Number(raw) : 4001
  return Number.isFinite(n) ? n : 4001
})()

interface PrescriberRecord {
  external_id: string
  attributes: Record<string, unknown>
}

/** Estado em memória — reset via POST /__reset. */
const registered = new Map<string, PrescriberRecord>()

function mintToken(externalId: string): string {
  // JWT de mentira, estável por id — suficiente para o launcher (data-token).
  return `memed-mock-token.${Buffer.from(externalId).toString('base64url')}.stub`
}

const SPECIALTIES = [
  { id: 'cardiologia', nome: 'Cardiologia' },
  { id: 'pediatria', nome: 'Pediatria' },
  { id: 'clinica-geral', nome: 'Clínica Geral' },
  { id: 'ortopedia', nome: 'Ortopedia' },
  { id: 'ginecologia', nome: 'Ginecologia' },
]

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/vnd.api+json',
    'access-control-allow-origin': '*',
  })
  res.end(payload)
}

function notFound(res: ServerResponse): void {
  json(res, 404, { errors: [{ title: 'Usuário não encontrado' }] })
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/** Campos obrigatórios do prescritor (FR-001, 7 campos). */
function missingPrescriberFields(attrs: Record<string, unknown>): string[] {
  const board = (attrs.board ?? {}) as Record<string, unknown>
  const required: Array<[string, unknown]> = [
    ['external_id', attrs.external_id],
    ['nome', attrs.nome],
    ['sobrenome', attrs.sobrenome],
    ['cpf', attrs.cpf],
    ['board.board_code', board.board_code],
    ['board.board_number', board.board_number],
    ['board.board_state', board.board_state],
    ['data_nascimento', attrs.data_nascimento],
  ]
  return required
    .filter(([, v]) => v === undefined || v === null || String(v).trim() === '')
    .map(([field]) => field)
}

function serveStatic(res: ServerResponse, file: string, contentType: string): void {
  try {
    const body = readFileSync(join(__dir, file))
    res.writeHead(200, {
      'content-type': contentType,
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch {
    res.writeHead(500).end('stub file missing')
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const path = url.pathname
  const method = req.method ?? 'GET'

  // --- infra de teste -----------------------------------------------------
  if (path === '/__health') return void res.writeHead(200).end('ok')
  if (path === '/__reset' && method === 'POST') {
    registered.clear()
    return void json(res, 200, { ok: true })
  }
  if (path === '/__register' && method === 'POST') {
    const body = (await readBody(req)) as { external_id?: string } | undefined
    const id = body?.external_id
    if (!id) return void json(res, 400, { errors: [{ title: 'external_id obrigatório' }] })
    registered.set(id, { external_id: id, attributes: { external_id: id } })
    return void json(res, 200, { ok: true, token: mintToken(id) })
  }
  if (path === '/iframe-stub.html') return void serveStatic(res, 'iframe-stub.html', 'text/html; charset=utf-8')
  if (path === '/sdk-stub.js') return void serveStatic(res, 'memed-sdk-stub.js', 'application/javascript; charset=utf-8')

  // --- "API Memed" ----------------------------------------------------------
  // Conformidade: o client manda as chaves na query string. Sem elas → 400.
  const hasKeys = url.searchParams.has('api-key') && url.searchParams.has('secret-key')
  if (!hasKeys) {
    return void json(res, 400, { errors: [{ title: 'api-key/secret-key ausentes' }] })
  }

  if (path === '/especialidades' && method === 'GET') {
    return void json(res, 200, { data: SPECIALTIES })
  }

  if (path === '/sinapse-prescricao/usuarios' && method === 'POST') {
    const body = (await readBody(req)) as
      | { data?: { attributes?: Record<string, unknown> } }
      | undefined
    const attrs = body?.data?.attributes ?? {}
    const missing = missingPrescriberFields(attrs)
    if (missing.length > 0) {
      return void json(res, 422, {
        errors: missing.map((field) => ({ field, title: `${field} obrigatório` })),
      })
    }
    const id = String(attrs.external_id)
    if (registered.has(id)) {
      return void json(res, 422, {
        errors: [{ title: 'Usuário já cadastrado para o parceiro com esse id externo' }],
      })
    }
    registered.set(id, { external_id: id, attributes: attrs })
    return void json(res, 201, {
      data: {
        type: 'usuarios',
        id,
        attributes: { external_id: id, token: mintToken(id), status: 'registered' },
      },
    })
  }

  const usuarioMatch = /^\/sinapse-prescricao\/usuarios\/([^/]+)$/.exec(path)
  if (usuarioMatch) {
    const id = decodeURIComponent(usuarioMatch[1]!)
    if (method === 'GET') {
      if (!registered.has(id)) return void notFound(res)
      return void json(res, 200, {
        data: { type: 'usuarios', id, attributes: { external_id: id, token: mintToken(id) } },
      })
    }
    if (method === 'PATCH') {
      if (!registered.has(id)) return void notFound(res)
      const body = (await readBody(req)) as
        | { data?: { attributes?: Record<string, unknown> } }
        | undefined
      registered.set(id, { external_id: id, attributes: body?.data?.attributes ?? {} })
      return void json(res, 200, {
        data: { type: 'usuarios', id, attributes: { external_id: id, token: mintToken(id) } },
      })
    }
  }

  return void json(res, 404, { errors: [{ title: `rota desconhecida: ${method} ${path}` }] })
})

server.listen(PORT, () => {
  // Nunca logar chaves — só a porta.
  console.info(`[memed-mock] listening on http://localhost:${PORT}`)
})

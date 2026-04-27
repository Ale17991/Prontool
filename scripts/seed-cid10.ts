#!/usr/bin/env tsx
/**
 * Importa o catálogo CID-10 (Classificação Estatística Internacional de
 * Doenças e Problemas Relacionados à Saúde, 10ª revisão) para
 * `cid10_codes`. Dado público da OMS / DataSUS — adoção brasileira.
 *
 * Fontes recomendadas (definir CID10_SOURCE_URL apontando para JSON):
 *   - https://github.com/jamilatta/cid10-json (cid10.json)
 *   - https://raw.githubusercontent.com/<user>/cid10-json/<sha>/cid10.json
 *
 * Shape esperado: array de objetos { codigo: string, descricao: string,
 *   capitulo?: string }. Aceita também { code, description, chapter }
 *   (snake mapeado em normalize).
 *
 * Uso:
 *   pnpm seed:cid10                               # local (.env.local)
 *   pnpm seed:cid10:prod                          # prod (.env.production.local)
 *   CID10_SOURCE_URL=<url> pnpm seed:cid10        # override da URL
 */
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'

const DEFAULT_URL = process.env.CID10_SOURCE_URL ?? null

interface SourceRow {
  codigo?: string
  code?: string
  descricao?: string
  description?: string
  capitulo?: string | null
  chapter?: string | null
}

interface NormalizedRow {
  code: string
  description: string
  chapter: string | null
}

async function main(): Promise<void> {
  if (!DEFAULT_URL) {
    console.error(
      '[seed-cid10] ABORTADO: defina CID10_SOURCE_URL apontando para um JSON do catálogo CID-10.',
    )
    console.error('[seed-cid10] Sugestão: jamilatta/cid10-json, github.com/<repo>/cid10.json')
    console.error(
      '[seed-cid10] Ex.: CID10_SOURCE_URL=https://raw.githubusercontent.com/.../cid10.json pnpm seed:cid10',
    )
    process.exit(2)
  }

  console.info(`[seed-cid10] baixando ${DEFAULT_URL}…`)
  const res = await fetch(DEFAULT_URL)
  if (!res.ok) throw new Error(`failed to download ${DEFAULT_URL}: HTTP ${res.status}`)
  const raw = await res.text()
  console.info(`[seed-cid10] baixou ${(raw.length / 1024).toFixed(1)} KB`)

  const json = JSON.parse(raw) as SourceRow[] | { rows: SourceRow[] }
  const rows = Array.isArray(json) ? json : json.rows
  if (!Array.isArray(rows)) {
    throw new Error('payload sem array (esperado SourceRow[] ou { rows: SourceRow[] })')
  }

  const normalized = normalize(rows)
  console.info(`[seed-cid10] parseou ${normalized.length} códigos únicos`)

  const supabase = createSupabaseServiceClient()
  const BATCH = 1000
  for (let i = 0; i < normalized.length; i += BATCH) {
    const slice = normalized.slice(i, i + BATCH)
    const { error } = await supabase
      .from('cid10_codes')
      .upsert(slice, { onConflict: 'code' })
    if (error) throw new Error(`cid10_codes upsert offset=${i}: ${error.message}`)
    console.info(
      `[seed-cid10] upsert ${Math.min(i + BATCH, normalized.length)}/${normalized.length}`,
    )
  }

  console.info('[seed-cid10] concluído.')
}

function normalize(rows: SourceRow[]): NormalizedRow[] {
  const seen = new Map<string, NormalizedRow>()
  for (const r of rows) {
    const code = (r.codigo ?? r.code ?? '').toString().trim().toUpperCase()
    const description = (r.descricao ?? r.description ?? '').toString().trim()
    if (!code || !description) continue
    const chapter = ((r.capitulo ?? r.chapter ?? null) || null) as string | null
    seen.set(code, { code, description, chapter })
  }
  return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code))
}

main().catch((err: unknown) => {
  console.error('[seed-cid10] fatal:', err)
  process.exit(1)
})

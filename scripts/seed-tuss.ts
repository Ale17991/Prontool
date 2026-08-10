#!/usr/bin/env tsx
/**
 * Importa o catálogo TUSS (tabelas 18 — diárias/taxas/gases, 19 — materiais e
 * OPME, 20 — medicamentos, 22 — procedimentos e eventos em saúde) para
 * `tuss_codes`, a partir do pacote publicado pela própria ANS.
 *
 * A leitura da fonte (download, extração e parse das planilhas) vive em
 * `scripts/tuss-ans-source.ts`, compartilhada com o verificador de colisão.
 * Aqui fica só a escrita no banco.
 *
 * A fonte oficial dispensa o antigo portão `SEED_TUSS_FORCE=1`, que existia
 * porque o espelho comunitário não declarava licença. Tabela publicada por
 * agência federal é ato oficial (Lei 9.610/98 art. 8º IV) — ver
 * docs/data-sources.md.
 *
 * CUSTO: o zip tem ~410 MB (a Tabela 19 sozinha tem ~1,5 milhão de linhas).
 * Fica em cache em `.cache/tuss/` e só é baixado de novo se sumir.
 *
 * Uso:
 *   pnpm seed:tuss:22                      # procedimentos
 *   pnpm seed:tuss:19                      # materiais/OPME (~1,5 M — demorado)
 *   pnpm seed:tuss:20                      # medicamentos
 *   pnpm seed:tuss:18                      # diárias, taxas e gases
 *   pnpm seed:tuss:all                     # os quatro em sequência
 *   tsx scripts/seed-tuss.ts --table 22 --version 202607
 *   TUSS_ANS_ZIP=/caminho/local.zip pnpm seed:tuss:all   # pula o download
 */
import { createHash } from 'node:crypto'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { detectDeprecatedTussCodes } from '@/lib/core/catalog/detect-deprecated'
import {
  SUPPORTED_TABLES,
  type TussSourceRow,
  type TussTable,
  ensureAnsZip,
  parseVersionArg,
  readTable,
} from './tuss-ans-source'

const UPSERT_BATCH = 2000

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const tables = parseTables(args)
  const version = parseVersionArg(args)

  const zipPath = await ensureAnsZip(version)
  const supabase = createSupabaseServiceClient()

  /**
   * Guarda cross-tabela: `tuss_codes` tem UNIQUE(code) GLOBAL (decisão da 0037,
   * "opção B"). Se duas tabelas da ANS passarem a compartilhar um código, o
   * upsert da segunda sobrescreveria a linha da primeira em silêncio — o item
   * mudaria de tabela sozinho e a guia sairia com codigoTabela errado. Rodando
   * `--table all` a colisão é detectada aqui, antes de qualquer escrita ser
   * dada como boa; `scripts/check-tuss-collision.ts` faz o mesmo sem tocar no
   * banco.
   */
  const codeOwner = new Map<string, TussTable>()

  for (const table of tables) {
    console.info(`[seed-tuss] === tabela ${table}`)
    const rows = await readTable(zipPath, table)

    for (const r of rows) {
      const owner = codeOwner.get(r.code)
      if (owner && owner !== table) {
        throw new Error(
          `[seed-tuss] COLISÃO: código ${r.code} aparece nas tabelas ${owner} e ${table}. ` +
            'UNIQUE(code) global (migration 0037) deixou de valer — o schema precisa ' +
            'migrar para chave composta (tuss_table, code) antes de seguir.',
        )
      }
      codeOwner.set(r.code, table)
    }

    // Hash incremental: `JSON.stringify(rows)` da Tabela 19 seria uma string de
    // ~300 MB só pra ser descartada.
    const digest = createHash('sha256')
    for (const r of rows) digest.update(JSON.stringify(r))
    const hash = digest.digest('hex')

    const retired = rows.filter((r) => r.valid_to !== null).length
    console.info(
      `[seed-tuss] tabela ${table}: ${rows.length} códigos (${retired} com fim de vigência), ` +
        `content-hash ${hash.slice(0, 12)}`,
    )

    const versionId = await recordCatalogVersion(supabase, table, version, hash, rows.length)
    await upsertRows(supabase, table, rows, versionId)
  }

  // O scan roda uma vez, no fim: um código aposentado afeta qualquer procedure
  // que aponte pra ele, independente da tabela de origem.
  const scan = await detectDeprecatedTussCodes()
  console.info(`[seed-tuss] scan deprecation: scanned=${scan.scanned} alerts=${scan.alerts}`)

  console.info('[seed-tuss] concluído.')
}

function parseTables(args: string[]): TussTable[] {
  const i = args.indexOf('--table')
  if (i < 0) return ['22']
  const v = args[i + 1]
  if (v === 'all') return [...SUPPORTED_TABLES]
  if (v && (SUPPORTED_TABLES as string[]).includes(v)) return [v as TussTable]
  throw new Error(`--table inválido: ${v} (aceitos: ${SUPPORTED_TABLES.join(', ')} ou 'all')`)
}

async function recordCatalogVersion(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  table: TussTable,
  version: string,
  hash: string,
  count: number,
): Promise<string> {
  const insert = await supabase
    .from('tuss_catalog_versions')
    .insert({
      source_ref: `tabela_${table}@ANS-${version}`,
      content_hash: hash,
      code_count: count,
      notes:
        `seed-tuss.ts table=${table} fonte=ANS ` +
        `Padrao_TISS_Representacao_de_Conceitos_em_Saude_${version}.zip`,
    })
    .select('id')
    .single()
  if (insert.error || !insert.data) {
    throw new Error(`tuss_catalog_versions insert failed: ${insert.error?.message}`)
  }
  return insert.data.id
}

async function upsertRows(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  table: TussTable,
  rows: TussSourceRow[],
  versionId: string,
): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const slice = rows.slice(i, i + UPSERT_BATCH).map((r) => ({
      code: r.code,
      description: r.description,
      manufacturer: r.manufacturer,
      tuss_table: table,
      valid_from: r.valid_from,
      valid_to: r.valid_to,
      source_catalog_version_id: versionId,
    }))
    await withRetry(`upsert tabela=${table} offset=${i}`, async () => {
      const { error } = await supabase.from('tuss_codes').upsert(slice, { onConflict: 'code' })
      if (error) throw new Error(error.message)
    })
    const done = Math.min(i + UPSERT_BATCH, rows.length)
    if (done === rows.length || (i / UPSERT_BATCH) % 10 === 0) {
      console.info(`[seed-tuss] tabela ${table}: upsert ${done}/${rows.length}`)
    }
  }
}

/**
 * Repete a operação com espera crescente.
 *
 * A Tabela 19 são ~750 requisições em sequência, e numa carga local UMA delas
 * falhou com `TypeError: fetch failed` — soluço de conexão, não erro de dado.
 * Sem repetição, o seed morria em 53% e a hora de trabalho ia junto; contra a
 * produção, pela internet, a chance disso é maior, não menor. O upsert é
 * idempotente (`onConflict: 'code'`), então repetir o mesmo lote é seguro.
 *
 * Erro de VALIDAÇÃO não deve ser repetido — insistir num CHECK violado só
 * atrasa a mensagem que o operador precisa ler. Por isso só entra em retry o
 * que parece transporte.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  let waitMs = 1000
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const transient =
        /fetch failed|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|network|timeout|502|503|504/i
      if (attempt >= attempts || !transient.test(msg)) {
        throw new Error(`tuss_codes ${label}: ${msg}`)
      }
      console.warn(
        `[seed-tuss] ${label}: ${msg} — tentativa ${attempt}/${attempts}, aguardando ${waitMs}ms`,
      )
      await new Promise((r) => setTimeout(r, waitMs))
      waitMs *= 2
    }
  }
}

main().catch((err: unknown) => {
  console.error('[seed-tuss] fatal:', err)
  process.exit(1)
})

/**
 * Feature 029 (US5) — seed da Tabela 38 (Motivos de Glosa) em
 * `tiss_domain_tables` (domínio '38').
 *
 * FONTE OFICIAL (sem transcrição manual): a Tabela 38 NÃO é enumerada no XSD
 * (por isso `seed-tiss-domains.ts` não a cobre). Os motivos vêm do CodeSystem
 * FHIR oficial da ANS, versionado no repo em
 * `src/lib/core/tiss/schemas/tuss-38/CodeSystem-tuss-38.json` (ver SOURCE.md).
 *
 * Cada `concept` do CodeSystem vira uma linha `{ domain_number: '38', code,
 * description }`. Idempotente: upsert com ON CONFLICT DO NOTHING (a tabela é
 * append-only). A faixa 9901–9999 (motivos próprios da operadora) é sempre
 * aceita pela validação e não precisa estar aqui.
 *
 * Uso: `pnpm seed:tuss-38`
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const DOMAIN_NUMBER = '38'
const VALID_FROM = '2000-01-01'

interface FhirConcept {
  code: string
  display?: string
}
interface FhirCodeSystem {
  version?: string
  concept?: FhirConcept[]
}

function loadConcepts(): { version: string; concepts: FhirConcept[] } {
  const path = join(
    process.cwd(),
    'src',
    'lib',
    'core',
    'tiss',
    'schemas',
    'tuss-38',
    'CodeSystem-tuss-38.json',
  )
  const cs = JSON.parse(readFileSync(path, 'utf8')) as FhirCodeSystem
  const concepts = (cs.concept ?? []).filter((c) => typeof c.code === 'string' && c.code.length > 0)
  if (concepts.length === 0) {
    throw new Error('[seed-tuss-38] CodeSystem sem conceitos — asset ausente ou corrompido')
  }
  return { version: cs.version ?? 'desconhecida', concepts }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios')
  }

  const { version, concepts } = loadConcepts()
  const payload = concepts.map((c) => ({
    domain_number: DOMAIN_NUMBER,
    code: c.code,
    description: (c.display ?? c.code).trim(),
    valid_from: VALID_FROM,
  }))

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { error } = await supabase
    .from('tiss_domain_tables')
    .upsert(payload, { onConflict: 'domain_number,code,valid_from', ignoreDuplicates: true })
  if (error) throw new Error(`[seed-tuss-38] upsert falhou: ${error.message}`)

  // eslint-disable-next-line no-console
  console.log(
    `[seed-tuss-38] concluído — ${payload.length} motivos da Tabela 38 (CodeSystem ANS v${version}).`,
  )
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})

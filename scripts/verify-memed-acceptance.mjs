#!/usr/bin/env node
/**
 * Conformidade Memed (Feature 027 / US7, FR-017) — valida o registro de aceite
 * institucional em `docs/legal/memed-acceptance-record.md`.
 *
 * Gate pré-produção: exige
 *   (a) `responsável:` preenchido (não vazio, não placeholder);
 *   (b) `data:` em formato ISO (AAAA-MM-DD);
 *   (c) os 9 itens de conformidade marcados `[x]`.
 *
 * Exit 0 = aceite completo. Exit 1 = falta algo (mensagem específica).
 *
 * Uso: node scripts/verify-memed-acceptance.mjs  |  pnpm verify:memed-acceptance
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DOC = join(__dirname, '..', 'docs', 'legal', 'memed-acceptance-record.md')
const REQUIRED_ITEMS = 9

function fail(msg) {
  console.error(`[verify:memed-acceptance] FALHA: ${msg}`)
  process.exit(1)
}

function main() {
  if (!existsSync(DOC)) {
    fail(`registro não encontrado em docs/legal/memed-acceptance-record.md`)
  }
  const src = readFileSync(DOC, 'utf8')

  // (a) responsável
  const respMatch = src.match(/\*\*respons[áa]vel:\*\*\s*(.*)/i)
  const resp = (respMatch?.[1] ?? '').replace(/<!--.*?-->/g, '').trim()
  if (!resp) {
    fail('campo "responsável" vazio (preencha nome do responsável pelo aceite).')
  }

  // (b) data ISO
  const dataMatch = src.match(/\*\*data:\*\*\s*([^\s<]*)/i)
  const data = (dataMatch?.[1] ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    fail(`campo "data" ausente ou fora do ISO AAAA-MM-DD (encontrado: "${data}").`)
  }

  // (c) 9 itens marcados [x]
  const checked = [...src.matchAll(/^\s*\d+\.\s*\[x\]/gim)].length
  if (checked < REQUIRED_ITEMS) {
    fail(`${checked}/${REQUIRED_ITEMS} itens de conformidade marcados [x]. Marque todos os 9 no aceite real.`)
  }

  console.info(
    `[verify:memed-acceptance] OK — aceite por "${resp}" em ${data}; ${checked}/${REQUIRED_ITEMS} itens confirmados.`,
  )
}

main()

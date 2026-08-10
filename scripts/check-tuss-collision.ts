#!/usr/bin/env tsx
/**
 * Verifica se os códigos das tabelas TUSS 18, 19, 20 e 22 colidem entre si.
 *
 * Precondição da "opção B" do schema multi-tabela (migration 0037, ampliada
 * pela 0194): manter UNIQUE(code) GLOBAL em `tuss_codes`. Se este script
 * reportar colisão numa atualização futura da ANS, a opção B quebra e o schema
 * precisa migrar para chave composta (tuss_table, code) — porque o upsert do
 * seed passaria a sobrescrever a linha de uma tabela com a de outra, e o item
 * sairia na guia com `codigoTabela` errado.
 *
 * Lê pela MESMA rotina que o seed (`scripts/tuss-ans-source.ts`): um parser
 * próprio aqui poderia aprovar um pacote que o seed lê de outro jeito, que é
 * exatamente o caso em que a verificação teria de falhar.
 *
 * Uso:
 *   pnpm check:tuss-collision
 *   tsx scripts/check-tuss-collision.ts --version 202607
 *
 * exit 0 = sem colisão; exit 1 = colisão detectada; exit 2 = falha de execução.
 */
import {
  SUPPORTED_TABLES,
  type TussTable,
  ensureAnsZip,
  parseVersionArg,
  readTable,
} from './tuss-ans-source'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const version = parseVersionArg(args)
  const zipPath = await ensureAnsZip(version)

  const sets = new Map<TussTable, Set<string>>()
  for (const table of SUPPORTED_TABLES) {
    const rows = await readTable(zipPath, table)
    sets.set(table, new Set(rows.map((r) => r.code)))
    console.info(`[check] tabela ${table}: ${rows.length} códigos`)
  }

  let collisions = 0
  for (let i = 0; i < SUPPORTED_TABLES.length; i++) {
    for (let j = i + 1; j < SUPPORTED_TABLES.length; j++) {
      const a = SUPPORTED_TABLES[i] as TussTable
      const b = SUPPORTED_TABLES[j] as TussTable
      const overlap: string[] = []
      for (const code of sets.get(a) ?? []) {
        if (sets.get(b)?.has(code)) overlap.push(code)
      }
      if (overlap.length > 0) {
        console.error(
          `[check] COLISÃO ${a}∩${b}: ${overlap.length} códigos. ` +
            `Amostra: ${overlap.slice(0, 5).join(', ')}`,
        )
        collisions += overlap.length
      } else {
        console.info(`[check] ${a}∩${b}: 0 colisões`)
      }
    }
  }

  if (collisions > 0) {
    console.error(
      `[check] FALHA: ${collisions} colisões. UNIQUE(code) global (0037) é inválido ` +
        'nesta versão da ANS — migrar para chave composta antes de rodar o seed.',
    )
    process.exit(1)
  }
  console.info(`[check] OK: nenhum código colide entre as ${SUPPORTED_TABLES.length} tabelas.`)
}

main().catch((err: unknown) => {
  console.error('[check] fatal:', err)
  process.exit(2)
})

/**
 * T014 (Feature 029) — teste-âncora da pipeline de validação XML × XSD 04.03.00.
 *
 * Garante que `validateTissXml` carrega os XSDs oficiais (resolvendo os
 * include/import) e roda o libxml (xmllint-wasm). Prova negativa: documentos
 * que não são uma `mensagemTISS` válida são REJEITADOS com erros. O caminho
 * positivo (XML gerado valida) é exercitado nos testes de US2/US4, quando os
 * renderizadores existem.
 *
 * Não toca o banco — seguro rodar isoladamente.
 */
import { describe, it, expect } from 'vitest'
import { validateTissXml } from '@/lib/core/tiss/validate'

describe('Feature 029 — pipeline de validação TISS XSD 04.03.00', () => {
  it('carrega os XSDs e rejeita um XML que não é mensagemTISS', async () => {
    const result = await validateTissXml('<?xml version="1.0" encoding="UTF-8"?><foo/>')
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('rejeita uma mensagemTISS incompleta (sem cabecalho/epilogo)', async () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas"/>'
    const result = await validateTissXml(xml)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

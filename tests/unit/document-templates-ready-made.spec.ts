/**
 * Biblioteca de documentos prontos.
 *
 * Estes textos viram atestado, declaração e termo de consentimento assinados.
 * Um placeholder com grafia errada não falha em lugar nenhum: sai como texto
 * cru no papel entregue ao paciente. É isso que os testes travam.
 */
import { describe, expect, it } from 'vitest'
import { READY_MADE_DOCUMENTS, readyMadeDocument } from '@/lib/core/document-templates/ready-made'
import {
  AVAILABLE_PLACEHOLDERS,
  substitutePlaceholders,
} from '@/lib/core/document-templates/placeholders'

/** Mesmo limite do schema de `POST /api/document-templates`. */
const MAX_BODY = 8000
const VALID = new Set(AVAILABLE_PLACEHOLDERS.map((p) => p.key))

describe('biblioteca de documentos', () => {
  it('tem documentos e nenhum slug duplicado', () => {
    expect(READY_MADE_DOCUMENTS.length).toBeGreaterThan(0)
    const slugs = READY_MADE_DOCUMENTS.map((d) => d.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  for (const doc of READY_MADE_DOCUMENTS) {
    describe(doc.name, () => {
      it('cabe no limite da rota', () => {
        expect(doc.body.length).toBeGreaterThan(0)
        expect(doc.body.length).toBeLessThanOrEqual(MAX_BODY)
      })

      it('todo placeholder existe de verdade', () => {
        // Grafia errada não falha em lugar nenhum: `substitutePlaceholders`
        // troca desconhecido por vazio, então o defeito só apareceria no papel
        // já entregue — ou, pior, como um campo silenciosamente em branco.
        const usados = [...doc.body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!)
        for (const key of usados) {
          expect(VALID.has(key), `placeholder desconhecido: {{${key}}} em ${doc.slug}`).toBe(true)
        }
      })

      it('não sobra chave não substituída depois de preencher', () => {
        const vars = Object.fromEntries(AVAILABLE_PLACEHOLDERS.map((p) => [p.key, 'X']))
        const out = substitutePlaceholders(doc.body, vars)
        expect(out).not.toMatch(/\{\{/)
      })

      it('tem nome, dica e parâmetros de impressão válidos', () => {
        expect(doc.name.trim().length).toBeGreaterThan(0)
        expect(doc.hint.trim().length).toBeGreaterThan(0)
        expect(['A4', 'A5', 'LETTER']).toContain(doc.paperSize)
        expect(doc.fontSize).toBeGreaterThanOrEqual(8)
        expect(doc.fontSize).toBeLessThanOrEqual(18)
      })
    })
  }

  it('atestado e declaração trazem espaço para assinatura', () => {
    // Documento sem assinatura não serve para nada na hora de entregar.
    for (const slug of ['atestado-simples', 'declaracao-comparecimento']) {
      expect(readyMadeDocument(slug)!.body.toLowerCase()).toContain('assinatura')
    }
  })

  it('a declaração de comparecimento se distingue de atestado', () => {
    // Confundir os dois é o erro clássico: comparecimento comprova horário,
    // atestado afasta. O texto precisa dizer isso ao empregador que vai ler.
    const d = readyMadeDocument('declaracao-comparecimento')!
    expect(d.body).toContain('não configura atestado de afastamento')
    expect(d.body).toContain('às ______ horas')
  })

  it('o atestado tem espaço para o período de afastamento', () => {
    const a = readyMadeDocument('atestado-simples')!
    expect(a.body).toContain('dias')
    expect(a.body).toContain('CID')
  })

  it('o termo de consentimento cobre risco, alternativa e direito de revogar', () => {
    const t = readyMadeDocument('consentimento')!.body.toLowerCase()
    expect(t).toContain('riscos')
    expect(t).toContain('alternativas')
    expect(t).toContain('retirar este consentimento')
  })

  it('a orientação de coleta não manda suspender medicamento por conta própria', () => {
    const o = readyMadeDocument('orientacao-jejum')!.body
    expect(o).toContain('NÃO suspenda nenhum medicamento por conta própria')
  })

  it('resolve por slug e devolve undefined em slug desconhecido', () => {
    expect(readyMadeDocument('atestado-simples')?.docType).toBe('atestado')
    expect(readyMadeDocument('nao-existe')).toBeUndefined()
  })
})

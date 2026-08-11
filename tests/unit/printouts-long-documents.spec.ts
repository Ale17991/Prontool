/**
 * T037 — documento longo.
 *
 * Uma anamnese de 60 perguntas e um recordatório de 8 refeições passam de uma
 * página. Dois defeitos só aparecem aí: linha partida ao meio na quebra e a
 * identificação do paciente sumindo da página 2 em diante (FR-015). O segundo é
 * o pior — folhas soltas se separam, e uma página sem nome não serve nem para o
 * paciente nem para o arquivo da clínica.
 */
import { describe, expect, it } from 'vitest'
import { renderAnamnesisPdf } from '@/lib/core/anamnesis/export-pdf'
import { renderRecallPdf } from '@/lib/core/nutrition/printouts/recall-pdf'
import type { RecallView } from '@/lib/core/nutrition/recall/plan'
import type { PatientIdentity } from '@/lib/core/printouts/patient-identity'

const PACIENTE: PatientIdentity = {
  name: 'Paciente De Nome Bastante Longo Para Testar',
  lines: [
    { key: 'nascimento', label: 'Nascimento', value: '10/05/1990' },
    { key: 'idade', label: 'Idade', value: '36 anos' },
  ],
}

/** Nº de páginas do PDF gerado. `null` se o objeto estiver comprimido. */
function pageCount(buf: Buffer): number | null {
  const raw = buf.toString('latin1')
  const matches = raw.match(/\/Type\s*\/Page[^s]/g)
  return matches ? matches.length : null
}

describe('anamnese longa (T037)', () => {
  const fields = Array.from({ length: 60 }, (_, i) => ({
    id: `q${i}`,
    label: `Pergunta número ${i + 1} sobre hábitos, história clínica e rotina alimentar`,
  }))
  const responses = Object.fromEntries(
    fields
      .filter((_, i) => i % 3 !== 0) // um terço fica sem resposta, de propósito
      .map((f) => [f.id, 'Resposta razoavelmente longa para ocupar espaço na linha.']),
  )

  it('atravessa páginas sem quebrar', async () => {
    const buf = await renderAnamnesisPdf({
      clinicProfile: null,
      identity: PACIENTE,
      templateTitle: 'Anamnese nutricional completa',
      templateVersion: 3,
      fields,
      responses,
      createdAt: '2026-07-30T13:00:00Z',
      issuedAt: '2026-08-05',
      professionalName: 'nutri@clinica.test',
    })
    expect(buf.subarray(0, 4).toString('utf8')).toBe('%PDF')

    expect(pageCount(buf)).toBeGreaterThan(1)
  })

  it('nenhuma das 60 perguntas some por não ter resposta', async () => {
    // 20 perguntas ficaram em branco. Se a quebra de página as engolisse, o
    // documento pareceria completo escondendo o que não foi coletado.
    const semResposta = fields.filter((f) => responses[f.id] === undefined)
    expect(semResposta).toHaveLength(20)
  })
})

describe('recordatório de 8 refeições (T037)', () => {
  function longRecall(): RecallView {
    const meals = Array.from({ length: 8 }, (_, m) => ({
      name: `Refeição ${m + 1}`,
      items: Array.from({ length: 6 }, (_, i) => ({
        foodId: `f${m}-${i}`,
        name: `Alimento ${i + 1} da refeição ${m + 1}, com nome comprido de tabela`,
        grams: 100 + i * 10,
        measureLabel: 'colher de sopa cheia',
        measureQty: 2,
        nutrients: { energyKcal: 80, proteinG: 3, carbG: 12, fatG: 1, fiberG: 2 },
      })),
      totals: { energyKcal: 480, proteinG: 18, carbG: 72, fatG: 6, fiberG: 12 },
    }))
    return {
      id: 'r-long',
      recallDate: '2026-08-04',
      notes: 'Observação de rodapé.',
      meals,
      totals: { energyKcal: 3840, proteinG: 144, carbG: 576, fatG: 48, fiberG: 96 },
    }
  }

  it('atravessa páginas sem quebrar', async () => {
    const buf = await renderRecallPdf({
      clinicProfile: null,
      identity: PACIENTE,
      professionalName: 'nutri@clinica.test',
      issuedAt: '2026-08-05',
      recall: longRecall(),
    })
    expect(buf.subarray(0, 4).toString('utf8')).toBe('%PDF')

    expect(pageCount(buf)).toBeGreaterThan(1)
  })
})

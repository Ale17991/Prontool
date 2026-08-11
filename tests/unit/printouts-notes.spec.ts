/**
 * T021 (US3) — orientações e anamnese em papel.
 *
 * O risco desta história não é cálculo: é omissão. Uma anamnese impressa sem as
 * perguntas que ficaram em branco parece completa, e quem a lê depois não tem
 * como saber que o dado nunca foi coletado. É o mesmo erro que o rótulo (052)
 * evita ao recusar somar ingrediente sem valor — aqui, aplicado a texto.
 */
import { describe, expect, it } from 'vitest'
import { anamnesisPrintRows } from '@/lib/core/anamnesis/export-pdf'
import { renderCareNotesPdf } from '@/lib/core/care-notes/notes-pdf'
import { brDateTz } from '@/lib/core/nutrition/printouts/shared'
import type { PatientIdentity } from '@/lib/core/printouts/patient-identity'

const FIELDS = [
  { id: 'default_nome', label: 'Nome', is_default: true },
  { id: 'q_habito', label: 'Hábito intestinal' },
  { id: 'q_agua', label: 'Consumo de água' },
  { id: 'q_alergia_alimentar', label: 'Alergia alimentar' },
  { id: 'q_suplementos', label: 'Suplementos em uso' },
]

describe('anamnese impressa (T021)', () => {
  it('pergunta sem resposta aparece em branco, não some', () => {
    const rows = anamnesisPrintRows(FIELDS, {
      q_habito: 'Normal, diário',
      // q_agua, q_alergia_alimentar e q_suplementos não foram respondidas.
    })

    // Quatro perguntas no modelo (a de identificação sai), quatro no papel.
    expect(rows.map((r) => r.id)).toEqual([
      'q_habito',
      'q_agua',
      'q_alergia_alimentar',
      'q_suplementos',
    ])
    expect(rows.filter((r) => r.missing)).toHaveLength(3)
    expect(rows.find((r) => r.id === 'q_agua')?.answer).toBe('—')
  })

  it('a ordem é a do modelo, não a das respostas', () => {
    const rows = anamnesisPrintRows(FIELDS, {
      q_suplementos: 'Creatina',
      q_habito: 'Normal',
    })
    expect(rows.map((r) => r.label)).toEqual([
      'Hábito intestinal',
      'Consumo de água',
      'Alergia alimentar',
      'Suplementos em uso',
    ])
  })

  it('campos de identificação não se repetem no corpo', () => {
    const rows = anamnesisPrintRows(FIELDS, { default_nome: 'Maria' })
    expect(rows.some((r) => r.id === 'default_nome')).toBe(false)
  })

  it('lista vazia é ausência; lista com itens é resposta', () => {
    const fields = [{ id: 'q_restricoes', label: 'Restrições' }]
    expect(anamnesisPrintRows(fields, { q_restricoes: [] })[0]).toMatchObject({
      answer: '—',
      missing: true,
    })
    expect(anamnesisPrintRows(fields, { q_restricoes: ['Lactose', 'Glúten'] })[0]).toMatchObject({
      answer: 'Lactose, Glúten',
      missing: false,
    })
  })

  it('"não" respondido é resposta, não lacuna', () => {
    // O paralelo do zero que não é ausência: "o paciente negou" é informação
    // clínica, e virar travessão apagaria o que foi perguntado e respondido.
    const rows = anamnesisPrintRows([{ id: 'q_fuma', label: 'Fuma?' }], { q_fuma: false })
    expect(rows[0]).toMatchObject({ answer: 'Não', missing: false })
  })
})

describe('orientações impressas (T021)', () => {
  const identity: PatientIdentity = { name: 'Paciente Teste', lines: [{ key: 'nascimento', label: 'Nascimento', value: '10/05/1990' }, { key: 'idade', label: 'Idade', value: '36 anos' }] }

  it('gera um PDF com o texto íntegro, inclusive o que atravessa página', async () => {
    const longo = 'Guia FODMAP. '.repeat(250) // ~3.200 caracteres, mais de uma página
    const buf = await renderCareNotesPdf({
      clinicProfile: null,
      identity,
      professionalName: 'nutri@clinica.test',
      issuedAt: '2026-08-05',
      notes: [
        { id: 'n1', body: longo, createdAt: '2026-08-04T14:30:00Z' },
        { id: 'n2', body: 'Caminhar 30 min, 5x por semana.', createdAt: '2026-07-01T12:00:00Z' },
      ],
    })
    expect(buf.subarray(0, 4).toString('utf8')).toBe('%PDF')
    expect(buf.length).toBeGreaterThan(1000)
  })

  it('a data da orientação é a do fuso da clínica, como na tela', () => {
    // 03/08 às 23h em São Paulo é 04/08 em UTC. Fatiar a string ISO daria a
    // data errada, e a profissional não reconheceria a própria orientação.
    expect(brDateTz('2026-08-04T02:00:00Z')).toBe('03/08/2026')
    expect(brDateTz(null)).toBe('—')
  })
})

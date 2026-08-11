/**
 * Campos de paciente configuráveis nos impressos (0195).
 *
 * O que está travado aqui é o que não pode regredir sem alguém perceber: a
 * ordem impressa, o piso do nome, a diferença entre "campo desligado" e "campo
 * ligado sem dado", e o fato de a exceção do documento SUBSTITUIR o padrão em
 * vez de somar a ele.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRINTOUT_FIELDS,
  PRINTOUT_DOCUMENTS,
  PRINTOUT_PATIENT_FIELDS,
  hasOverride,
  resolvePrintoutFields,
  sanitizeFieldList,
} from '@/lib/core/printouts/fields'
import { buildPatientIdentity } from '@/lib/core/printouts/patient-identity'
import type { PatientDetail } from '@/lib/core/patients/get'

const PACIENTE = {
  id: 'p1',
  fullName: 'Maria da Silva',
  socialName: null,
  sex: 'feminino',
  cpf: '12345678901',
  rg: null,
  motherName: null,
  phone: '5511987654321',
  email: 'maria@exemplo.test',
  birthDate: '1990-05-10',
  insuranceCardNumber: null,
  guardianName: null,
  guardianRelationship: null,
  address: {
    cep: '01310-100',
    street: 'Av. Paulista',
    number: '1000',
    complement: null,
    neighborhood: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
  },
  healthPlan: { id: 'h1', name: 'Unimed' },
  anonymizedAt: null,
} as unknown as PatientDetail

describe('resolvePrintoutFields', () => {
  it('sem configuração usa o padrão do catálogo', () => {
    expect(resolvePrintoutFields(null, 'plano-alimentar')).toEqual([...DEFAULT_PRINTOUT_FIELDS])
  })

  it('usa o padrão da clínica quando o documento não tem exceção', () => {
    const cfg = { fields: ['cpf', 'nascimento'], overrides: {} }
    expect(resolvePrintoutFields(cfg, 'plano-alimentar')).toEqual(['nascimento', 'cpf'])
  })

  // O ponto da decisão de produto: a exceção SUBSTITUI. É o que permite a uma
  // clínica mostrar MENOS num documento que o paciente leva embora.
  it('exceção do documento substitui o padrão, não soma', () => {
    const cfg = {
      fields: ['nascimento', 'idade', 'cpf'],
      overrides: { 'plano-alimentar': ['idade'] },
    }
    expect(resolvePrintoutFields(cfg, 'plano-alimentar')).toEqual(['idade'])
    expect(resolvePrintoutFields(cfg, 'anamnese')).toEqual(['nascimento', 'idade', 'cpf'])
  })

  it('exceção vazia é uma escolha válida: só o nome', () => {
    const cfg = { fields: ['nascimento', 'cpf'], overrides: { 'receita-oculos': [] } }
    expect(resolvePrintoutFields(cfg, 'receita-oculos')).toEqual([])
    expect(hasOverride(cfg, 'receita-oculos')).toBe(true)
    expect(hasOverride(cfg, 'anamnese')).toBe(false)
  })

  it('a ordem é a do catálogo, não a de quem marcou as caixas', () => {
    const cfg = { fields: ['endereco', 'cpf', 'idade', 'nascimento'], overrides: {} }
    expect(resolvePrintoutFields(cfg, 'anamnese')).toEqual([
      'nascimento',
      'idade',
      'cpf',
      'endereco',
    ])
  })

  it('chave desconhecida é ignorada e não derruba o resto', () => {
    const cfg = { fields: ['nascimento', 'campo_que_nao_existe'], overrides: {} }
    expect(resolvePrintoutFields(cfg, 'anamnese')).toEqual(['nascimento'])
    expect(sanitizeFieldList(['cpf', 'lixo', 42])).toEqual(['cpf'])
  })

  it('o nome nunca entra na lista configurável', () => {
    expect(PRINTOUT_PATIENT_FIELDS.some((f) => (f.key as string) === 'nome')).toBe(false)
  })

  it('nem a guia TISS nem o prontuário são configuráveis', () => {
    const ids = PRINTOUT_DOCUMENTS.map((d) => d.id as string)
    expect(ids).not.toContain('guia-tiss')
    expect(ids).not.toContain('prontuario')
  })
})

describe('buildPatientIdentity', () => {
  it('formata os valores e mantém o nome fora das linhas', () => {
    const id = buildPatientIdentity(PACIENTE, ['nascimento', 'cpf', 'telefone'], '2026-08-11')
    expect(id.name).toBe('Maria da Silva')
    expect(id.lines.map((l) => [l.label, l.value])).toEqual([
      ['Nascimento', '10/05/1990'],
      ['CPF', '123.456.789-01'],
      ['Telefone', '(11) 98765-4321'],
    ])
  })

  // Campo ligado sem dado vira travessão no PDF; campo desligado não vira linha
  // nenhuma. Confundir os dois produz documento que parece completo.
  it('campo ligado sem dado no cadastro vira linha com valor nulo', () => {
    const id = buildPatientIdentity(PACIENTE, ['rg', 'nome_mae'], '2026-08-11')
    expect(id.lines).toEqual([
      { key: 'rg', label: 'RG', value: null },
      { key: 'nome_mae', label: 'Nome da mãe', value: null },
    ])
  })

  it('campo desligado não aparece', () => {
    const id = buildPatientIdentity(PACIENTE, ['nascimento'], '2026-08-11')
    expect(id.lines).toHaveLength(1)
  })

  // A idade é calculada sobre o DIA CIVIL da clínica: emitir na véspera do
  // aniversário não pode envelhecer o paciente por causa de fuso.
  it('idade não vira no dia anterior ao aniversário', () => {
    const vespera = buildPatientIdentity(PACIENTE, ['idade'], '2026-05-09')
    const aniversario = buildPatientIdentity(PACIENTE, ['idade'], '2026-05-10')
    expect(vespera.lines[0]?.value).toBe('35 anos')
    expect(aniversario.lines[0]?.value).toBe('36 anos')
  })

  it('endereço parcial imprime o que existe, sem exigir cadastro completo', () => {
    const id = buildPatientIdentity(PACIENTE, ['endereco'], '2026-08-11')
    expect(id.lines[0]?.value).toContain('Av. Paulista, 1000')
    expect(id.lines[0]?.value).toContain('São Paulo/SP')
  })
})

/**
 * Catálogo de módulos agrupado em blocos + política de campos obrigatórios
 * do paciente (base vs. clínica prescritora Memed).
 */
import { describe, expect, it } from 'vitest'
import {
  ALL_MODULES,
  EXPLICIT_ONLY_MODULES,
  MODULE_BLOCKS,
  MODULE_HINT,
  MODULE_LABEL,
  buildEntitlements,
  type ModuleId,
} from '@/lib/core/entitlements/plans'
import {
  describeMissingFields,
  missingMemedFields,
  missingRequiredPatientFields,
  patientFieldPolicy,
} from '@/lib/core/patients/required-fields'

describe('Blocos do catálogo de módulos', () => {
  it('todo módulo aparece em exatamente um bloco', () => {
    const seen = new Map<ModuleId, number>()
    for (const block of MODULE_BLOCKS) {
      for (const m of block.modules) seen.set(m, (seen.get(m) ?? 0) + 1)
    }
    for (const m of ALL_MODULES) {
      expect(seen.get(m), `módulo "${m}" fora dos blocos`).toBe(1)
    }
    expect(seen.size).toBe(ALL_MODULES.length)
  })

  it('todo módulo tem rótulo e descrição', () => {
    for (const m of ALL_MODULES) {
      expect(MODULE_LABEL[m]?.length ?? 0).toBeGreaterThan(0)
      expect(MODULE_HINT[m]?.length ?? 0).toBeGreaterThan(0)
    }
  })
})

describe('memed nunca chega por grandfather', () => {
  it('legacy sem módulos libera tudo MENOS memed', () => {
    const ent = buildEntitlements('legacy', [])
    expect(ent.hasModule('odonto')).toBe(true)
    expect(ent.hasModule('convenio')).toBe(true)
    // Ligar memed endurece o cadastro em toda a clínica — só por marcação
    // explícita no /admin, nunca por linha ausente/erro de leitura.
    expect(ent.hasModule('memed')).toBe(false)
    expect(EXPLICIT_ONLY_MODULES).toContain('memed')
  })

  it('legacy COM memed explícito é prescritora', () => {
    expect(buildEntitlements('legacy', ['memed']).hasModule('memed')).toBe(true)
  })
})

describe('Política de campos obrigatórios do paciente', () => {
  const base = patientFieldPolicy(false)
  const memed = patientFieldPolicy(true)

  it('base exige só nome e telefone', () => {
    expect(base.required).toEqual(['full_name', 'phone'])
  })

  it('prescritora Memed acrescenta CPF, e-mail e nascimento', () => {
    expect(memed.required).toContain('cpf')
    expect(memed.required).toContain('email')
    expect(memed.required).toContain('birth_date')
  })

  it('paciente só com nome e telefone passa na base e falha na Memed', () => {
    const values = { full_name: 'Maria Silva', phone: '(11) 99999-0000' }
    expect(missingRequiredPatientFields(values, base)).toEqual([])
    expect(missingRequiredPatientFields(values, memed)).toEqual(['cpf', 'email', 'birth_date'])
  })

  it('telefone curto demais não conta como preenchido', () => {
    expect(missingRequiredPatientFields({ full_name: 'Ana', phone: '1234' }, base)).toEqual([
      'phone',
    ])
  })

  it('CPF com máscara conta; com 10 dígitos, não', () => {
    const complete = {
      full_name: 'Maria Silva',
      phone: '11999990000',
      cpf: '123.456.789-09',
      email: 'maria@exemplo.com',
      birth_date: '1990-05-20',
    }
    expect(missingRequiredPatientFields(complete, memed)).toEqual([])
    expect(missingRequiredPatientFields({ ...complete, cpf: '1234567890' }, memed)).toEqual(['cpf'])
  })

  it('nascimento fora do ISO não conta', () => {
    const v = {
      full_name: 'Maria Silva',
      phone: '11999990000',
      cpf: '12345678909',
      email: 'maria@exemplo.com',
      birth_date: '20/05/1990',
    }
    expect(missingRequiredPatientFields(v, memed)).toEqual(['birth_date'])
  })

  it('missingMemedFields independe da política da clínica', () => {
    expect(missingMemedFields({ full_name: 'Ana Souza', phone: '11999990000' })).toEqual([
      'cpf',
      'email',
      'birth_date',
    ])
  })

  it('descrição em português junta com "e"', () => {
    expect(describeMissingFields(['cpf'])).toBe('CPF')
    expect(describeMissingFields(['cpf', 'email'])).toBe('CPF e e-mail')
    expect(describeMissingFields(['cpf', 'email', 'birth_date'])).toBe(
      'CPF, e-mail e data de nascimento',
    )
  })
})

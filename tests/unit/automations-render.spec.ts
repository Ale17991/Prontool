/**
 * T041 (Feature 056) — o catálogo de mensagens como CATÁLOGO.
 *
 * A propriedade que este arquivo trava é a que separa "catálogo" de "texto
 * colado em cada gatilho": a mesma mensagem serve fontes diferentes, e a
 * validação de variável é POR FONTE — o que uma sabe preencher, outra não.
 */
import { describe, it, expect } from 'vitest'
import { render, variablesNotProvidedBy } from '@/lib/core/automations/render'
import { getSource, listSources } from '@/lib/core/automations/sources'
import { UNIVERSAL_VARIABLES } from '@/lib/core/automations/types'

function variaveisDe(sourceId: string): string[] {
  const f = getSource(sourceId)
  if (!f) throw new Error(`fonte ${sourceId} não registrada`)
  return [...UNIVERSAL_VARIABLES, ...f.variables]
}

describe('validação de variável é por fonte', () => {
  it('uma mensagem só com variáveis universais serve QUALQUER fonte', () => {
    const corpo = 'Oi {{paciente}}, aqui é a {{clinica}}.'
    for (const f of listSources()) {
      expect(variablesNotProvidedBy(corpo, [...UNIVERSAL_VARIABLES, ...f.variables])).toEqual([])
    }
  })

  it('{{habito}} serve o gatilho de checklist e NÃO serve o de aniversário', () => {
    const corpo = 'Não vi sua marcação de {{habito}} esses dias.'
    expect(variablesNotProvidedBy(corpo, variaveisDe('checklist_sem_marcacao'))).toEqual([])
    expect(variablesNotProvidedBy(corpo, variaveisDe('aniversario'))).toEqual(['habito'])
  })

  it('{{data_consulta}} serve confirmação de agendamento e não os outros', () => {
    const corpo = 'Sua consulta ficou para {{data_consulta}}.'
    expect(variablesNotProvidedBy(corpo, variaveisDe('confirmacao_agendamento'))).toEqual([])
    expect(variablesNotProvidedBy(corpo, variaveisDe('sem_retorno'))).toEqual(['data_consulta'])
  })

  it('aponta TODAS as variáveis faltantes, não só a primeira', () => {
    const faltando = variablesNotProvidedBy('{{habito}} e {{data_consulta}}', [
      ...UNIVERSAL_VARIABLES,
    ])
    expect(faltando).toEqual(['habito', 'data_consulta'])
  })
})

describe('a mesma mensagem, fontes diferentes', () => {
  it('rende igual, com os valores que cada fonte fornece', () => {
    const corpo = 'Oi {{paciente}}, aqui é a {{clinica}}.'
    const a = render(corpo, { paciente: 'Maria', clinica: 'Clínica X' })
    const b = render(corpo, { paciente: 'João', clinica: 'Clínica X' })
    expect(a.text).toBe('Oi Maria, aqui é a Clínica X.')
    expect(b.text).toBe('Oi João, aqui é a Clínica X.')
  })

  it('editar o texto muda o resultado — não há cópia congelada em lugar nenhum', () => {
    // O render não guarda estado: quem muda o corpo muda o que sai, e é por
    // isso que editar a mensagem propaga para todos os gatilhos que a usam.
    const antes = render('Versão 1 para {{paciente}}', { paciente: 'Maria' })
    const depois = render('Versão 2 para {{paciente}}', { paciente: 'Maria' })
    expect(antes.text).toBe('Versão 1 para Maria')
    expect(depois.text).toBe('Versão 2 para Maria')
  })
})

describe('FR-009 — o guarda-corpo da linguagem', () => {
  it('a fonte de AUSÊNCIA declara aviso, e ele fala em "marcação"', () => {
    const f = getSource('checklist_sem_marcacao')
    expect(f?.warning).toBeTruthy()
    expect(f?.warning?.toLowerCase()).toMatch(/marca/)
  })

  it('o aviso NÃO afirma descumprimento', () => {
    const f = getSource('checklist_sem_marcacao')
    // O texto pode citar a expressão para PROIBIR seu uso; o que não pode é
    // apresentar a ausência de marcação como descumprimento.
    expect(f?.warning).toMatch(/nunca como|não que|não —/i)
  })

  it('a fonte de PRESENÇA não precisa de aviso: ali o dado é evidência', () => {
    expect(getSource('checklist_marcado')?.warning).toBeUndefined()
  })

  it('sem_retorno avisa sobre volume, que é o risco dela', () => {
    expect(getSource('sem_retorno')?.warning).toMatch(/prévia|teto|situação/i)
  })
})

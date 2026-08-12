/**
 * T036 (Feature 056) — o que não depende de banco: render e o registro de fontes.
 *
 * A regra mais importante testada aqui não é sobre comportamento, é sobre
 * ARQUITETURA: nem o registro nem o motor podem citar uma fonte pelo nome. É
 * essa ignorância que faz a absorção futura do lembrete de consulta (FR-025)
 * ser "mais um arquivo em sources/" em vez de reescrita — e é o tipo de
 * propriedade que se perde na primeira pressa se ninguém travar.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractVariables, render, variablesNotProvidedBy } from '@/lib/core/automations/render'
import { listSources, getSource } from '@/lib/core/automations/sources'
import { UNIVERSAL_VARIABLES } from '@/lib/core/automations/types'

describe('render — variáveis', () => {
  it('extrai as variáveis citadas, sem repetir', () => {
    expect(extractVariables('Oi {{paciente}}, aqui é a {{clinica}}. Tchau {{paciente}}!')).toEqual([
      'paciente',
      'clinica',
    ])
  })

  it('substitui quando todos os valores existem', () => {
    const r = render('Oi {{paciente}}, aqui é a {{clinica}}.', {
      paciente: 'Maria',
      clinica: 'Clínica X',
    })
    expect(r.text).toBe('Oi Maria, aqui é a Clínica X.')
    expect(r.missing).toEqual([])
  })

  it('devolve null quando falta valor — não manda texto com lacuna (FR-006)', () => {
    const r = render('Feliz aniversário, {{paciente}}!', {})
    expect(r.text).toBeNull()
    expect(r.missing).toEqual(['paciente'])
  })

  it('string vazia conta como ausente', () => {
    // "A equipe da  deseja" denuncia o defeito para o paciente. Melhor não
    // mandar do que mandar torto.
    const r = render('A equipe da {{clinica}} deseja.', { clinica: '   ' })
    expect(r.text).toBeNull()
    expect(r.missing).toEqual(['clinica'])
  })

  it('aponta a variável que a fonte não fornece', () => {
    expect(variablesNotProvidedBy('Oi {{paciente}}, seu {{procedimento}}', ['paciente'])).toEqual([
      'procedimento',
    ])
  })

  it('não acusa variável que a fonte fornece', () => {
    expect(variablesNotProvidedBy('Oi {{paciente}}', ['paciente', 'clinica'])).toEqual([])
  })
})

describe('registro de fontes', () => {
  it('a fonte de aniversário está registrada e declara suas variáveis', () => {
    const f = getSource('aniversario')
    expect(f).not.toBeNull()
    expect(f?.label).toBeTruthy()
    // Aniversário só precisa das universais — não declara nenhuma própria.
    expect(f?.variables).toEqual([])
  })

  it('toda fonte registrada tem rótulo, dica e schema de parâmetros', () => {
    for (const f of listSources()) {
      expect(f.id).toBeTruthy()
      expect(f.label.length).toBeGreaterThan(0)
      expect(f.hint.length).toBeGreaterThan(0)
      expect(f.paramsSchema).toBeTruthy()
    }
  })

  it('as variáveis universais existem para qualquer fonte', () => {
    expect([...UNIVERSAL_VARIABLES]).toContain('paciente')
    expect([...UNIVERSAL_VARIABLES]).toContain('clinica')
  })

  /**
   * FR-025 — o teste que protege a decisão de convivência.
   *
   * Se o registro ou o motor souberem QUAIS fontes existem, absorver o lembrete
   * de consulta deixa de ser adicionar um arquivo e vira reescrita. O único
   * lugar autorizado a citar fontes nominalmente é `sources/index.ts`.
   */
  it('nem o registro nem o motor citam fonte alguma pelo nome', () => {
    const raiz = join(process.cwd(), 'src', 'lib', 'core', 'automations')
    const registry = readFileSync(join(raiz, 'sources', 'registry.ts'), 'utf8')
    const evaluate = readFileSync(join(raiz, 'evaluate.ts'), 'utf8')

    const ids = listSources().map((f) => f.id)
    expect(ids.length).toBeGreaterThan(0)

    for (const id of ids) {
      // Fora de comentários: procuramos o identificador como string literal.
      expect(registry, `registry.ts não pode citar a fonte "${id}"`).not.toContain(`'${id}'`)
      expect(evaluate, `evaluate.ts não pode citar a fonte "${id}"`).not.toContain(`'${id}'`)
    }
  })
})

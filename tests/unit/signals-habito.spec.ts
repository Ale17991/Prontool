/**
 * T039 (Feature 053) — o predicado de "hábito sem registro".
 *
 * Os casos de fronteira aqui não são acadêmicos: cada um corresponde a uma
 * mensagem indevida no celular de um paciente real. O do "dia em curso" manda
 * cobrança às 9h por um hábito que a pessoa ainda vai cumprir à noite; o do
 * "piso da grade" cobra alguém por dias em que a grade nem existia.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { evaluateHabitoSemRegistro } from '@/lib/core/signals/families/ausencia/habito-sem-registro'

const TENANT = '11111111-1111-1111-1111-111111111111'
const PACIENTE = '22222222-2222-2222-2222-222222222222'
const HOJE = '2026-08-20'

interface Grade {
  id: string
  patient_id: string
  start_date: string
  items: { id: string; label: string }[]
}
interface Marca {
  checklist_id: string
  item_id: string
  mark_date: string
}

/**
 * Client falso que respeita os filtros aplicados pela família — o recorte por
 * data é parte da lógica em teste, e um mock de retorno fixo passaria mesmo
 * com o filtro errado.
 */
function fakeClient(grades: Grade[], marcas: Marca[]): SupabaseClient<Database> {
  return {
    from(tabela: string) {
      const estado: { desde?: string; ids?: string[] } = {}
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: (_c: string, v: string[]) => {
          estado.ids = v
          return chain
        },
        gte: (_c: string, v: string) => {
          estado.desde = v
          return chain
        },
        then: (resolve: (r: unknown) => void) => {
          if (tabela === 'patient_habit_checklists') {
            return Promise.resolve({ data: grades, error: null }).then(resolve)
          }
          const filtradas = marcas
            .filter((m) => (estado.ids ? estado.ids.includes(m.checklist_id) : true))
            .filter((m) => (estado.desde ? m.mark_date >= estado.desde : true))
          return Promise.resolve({ data: filtradas, error: null }).then(resolve)
        },
      }
      return chain
    },
  } as unknown as SupabaseClient<Database>
}

const GRADE: Grade = {
  id: 'g1',
  patient_id: PACIENTE,
  start_date: '2026-07-01',
  items: [
    { id: 'agua', label: 'Água 2L' },
    { id: 'sono', label: 'Dormir 8h' },
  ],
}

function avaliar(marcas: Marca[], params: Record<string, unknown> = { days: 3, itemId: 'agua' }) {
  return evaluateHabitoSemRegistro({
    supabase: fakeClient([GRADE], marcas),
    tenantId: TENANT,
    params,
    patientIds: [PACIENTE],
    cycleDate: HOJE,
    timezone: 'America/Sao_Paulo',
  })
}

function marca(dia: string, item = 'agua'): Marca {
  return { checklist_id: 'g1', item_id: item, mark_date: dia }
}

describe('habito_sem_registro — a condição', () => {
  it('dispara quando faltam N dias seguidos até ontem', async () => {
    // Marcou até 16/08; 17, 18 e 19 em branco. Hoje é 20.
    const r = await avaliar([marca('2026-08-16')])
    expect(r).toHaveLength(1)
    expect(r[0]!.patientId).toBe(PACIENTE)
    expect(r[0]!.values.habito).toBe('Água 2L')
  })

  it('não dispara quando marcou ontem', async () => {
    expect(await avaliar([marca('2026-08-19')])).toHaveLength(0)
  })

  it('não dispara com menos dias que o parâmetro', async () => {
    // 18 e 19 em branco = 2 dias, parâmetro é 3.
    expect(await avaliar([marca('2026-08-17')])).toHaveLength(0)
  })

  /**
   * O dia em curso não conta. Cobrar às 9h da manhã por um hábito que a pessoa
   * ainda vai cumprir à noite é cobrar cedo demais — e o paciente percebe que a
   * mensagem é automática e mal calibrada.
   */
  it('o dia de HOJE não entra na contagem', async () => {
    // Marcou até ontem: mesmo sem marcação de hoje, não há 3 dias em branco.
    expect(await avaliar([marca('2026-08-19')])).toHaveLength(0)
  })
})

describe('habito_sem_registro — o piso da grade', () => {
  it('não conta dias anteriores ao início da grade', async () => {
    const gradeNova: Grade = { ...GRADE, start_date: '2026-08-19' }
    const r = await evaluateHabitoSemRegistro({
      supabase: fakeClient([gradeNova], []),
      tenantId: TENANT,
      params: { days: 5, itemId: 'agua' },
      patientIds: [PACIENTE],
      cycleDate: HOJE,
      timezone: 'America/Sao_Paulo',
    })
    // Grade criada em 19/08, hoje é 20: existe 1 dia avaliável, não 5.
    expect(r).toHaveLength(0)
  })
})

describe('habito_sem_registro — agregação', () => {
  /**
   * Duas cobranças no mesmo dia sobre a mesma pessoa somam para desânimo, não
   * para adesão.
   */
  it('dois hábitos abandonados viram UMA mensagem, com os dois citados', async () => {
    const r = await avaliar([], { days: 3 })
    expect(r).toHaveLength(1)
    expect(r[0]!.values.habito).toBe('Água 2L e Dormir 8h')
    expect((r[0]!.observed.itens as unknown[]).length).toBe(2)
  })

  it('com itemId, só aquele item é avaliado', async () => {
    const r = await avaliar([marca('2026-08-19', 'sono')], { days: 3, itemId: 'agua' })
    expect(r).toHaveLength(1)
    expect(r[0]!.values.habito).toBe('Água 2L')
  })

  it('sem itemId, item marcado recentemente fica de fora da lista', async () => {
    const r = await avaliar([marca('2026-08-19', 'sono')], { days: 3 })
    expect(r).toHaveLength(1)
    expect(r[0]!.values.habito).toBe('Água 2L')
  })
})

describe('habito_sem_registro — bordas', () => {
  it('sem pacientes no público, não consulta nada', async () => {
    const r = await evaluateHabitoSemRegistro({
      supabase: fakeClient([], []),
      tenantId: TENANT,
      params: { days: 3 },
      patientIds: [],
      cycleDate: HOJE,
      timezone: 'America/Sao_Paulo',
    })
    expect(r).toEqual([])
  })

  it('paciente sem grade ativa não entra', async () => {
    const r = await evaluateHabitoSemRegistro({
      supabase: fakeClient([], []),
      tenantId: TENANT,
      params: { days: 3 },
      patientIds: [PACIENTE],
      cycleDate: HOJE,
      timezone: 'America/Sao_Paulo',
    })
    expect(r).toEqual([])
  })

  it('observed guarda o que foi visto, para o histórico explicar depois', async () => {
    const r = await avaliar([marca('2026-08-16')])
    expect(r[0]!.observed).toMatchObject({ checklistId: 'g1', janelaDias: 3 })
    expect(r[0]!.observed.ultimoDiaAvaliado).toBe('2026-08-19')
  })
})

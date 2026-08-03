/**
 * T053 (Feature 051) — apuração do SC-004.
 *
 * O que está sob teste não é aritmética: é a REGRA DE RECORTE. Uma taxa de
 * leitura errada não quebra nada visivelmente — só faz a clínica (e nós)
 * tomarmos decisão sobre um número falso. Por isso os casos aqui são os de
 * fronteira: leitura que atravessa o fim do período, ACK que a Evolution não
 * emitiu, e confirmação duplicada.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { getWhatsAppReadRate, ALVO_LEITURA_24H } from '@/lib/core/whatsapp/metrics'

const TENANT = '11111111-1111-1111-1111-111111111111'
const SINCE = '2026-08-01T00:00:00.000Z'
const UNTIL = '2026-08-31T00:00:00.000Z'

interface Evento {
  reminder_id: string
  status: string
  occurred_at: string
}

/**
 * Client falso que respeita os filtros que a função aplica. Não é mock de
 * retorno fixo de propósito: o recorte por `occurred_at` é justamente a lógica
 * em teste, e um mock cego passaria mesmo com o filtro errado.
 */
function fakeClient(eventos: Evento[]): SupabaseClient<Database> {
  return {
    from() {
      const estado: { desde?: string; ate?: string; ids?: string[] } = {}
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        gte: (_c: string, v: string) => {
          estado.desde = v
          return chain
        },
        lt: (_c: string, v: string) => {
          estado.ate = v
          return chain
        },
        in: (_c: string, v: string[]) => {
          estado.ids = v
          return chain
        },
        order: () => chain,
        range: (de: number, ate: number) => {
          const filtrado = eventos
            .filter((e) => (estado.desde === undefined ? true : e.occurred_at >= estado.desde))
            .filter((e) => (estado.ate === undefined ? true : e.occurred_at < estado.ate))
            .filter((e) => (estado.ids === undefined ? true : estado.ids.includes(e.reminder_id)))
            .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
          return Promise.resolve({ data: filtrado.slice(de, ate + 1), error: null })
        },
      }
      return chain
    },
  } as unknown as SupabaseClient<Database>
}

function ev(id: string, status: string, occurred_at: string): Evento {
  return { reminder_id: id, status, occurred_at }
}

describe('getWhatsAppReadRate — SC-004', () => {
  it('conta como lido quando a leitura vem dentro de 24h da entrega', async () => {
    const r = await getWhatsAppReadRate(
      fakeClient([
        ev('a', 'sent', '2026-08-10T10:00:00.000Z'),
        ev('a', 'delivered', '2026-08-10T10:01:00.000Z'),
        ev('a', 'read', '2026-08-10T12:00:00.000Z'),
      ]),
      TENANT,
      { since: SINCE, until: UNTIL },
    )
    expect(r.entregues).toBe(1)
    expect(r.lidos24h).toBe(1)
    expect(r.taxa).toBe(1)
    expect(r.atingiuAlvo).toBe(true)
  })

  it('leitura depois de 24h entra em lidosDepois, não no numerador', async () => {
    const r = await getWhatsAppReadRate(
      fakeClient([
        ev('a', 'delivered', '2026-08-10T10:00:00.000Z'),
        ev('a', 'read', '2026-08-11T10:00:01.000Z'), // 24h + 1s
      ]),
      TENANT,
      { since: SINCE, until: UNTIL },
    )
    expect(r.entregues).toBe(1)
    expect(r.lidos24h).toBe(0)
    expect(r.lidosDepois).toBe(1)
    expect(r.taxa).toBe(0)
  })

  it('exatamente 24h ainda conta como dentro da janela', async () => {
    const r = await getWhatsAppReadRate(
      fakeClient([
        ev('a', 'delivered', '2026-08-10T10:00:00.000Z'),
        ev('a', 'read', '2026-08-11T10:00:00.000Z'),
      ]),
      TENANT,
      { since: SINCE, until: UNTIL },
    )
    expect(r.lidos24h).toBe(1)
  })

  /**
   * O caso que motivou a cauda de busca de 24h. Sem ela, este lembrete entraria
   * no denominador e nunca no numerador — a taxa despencaria por artefato de
   * recorte, não por comportamento do paciente.
   */
  it('acha a leitura que acontece DEPOIS do fim do período', async () => {
    const r = await getWhatsAppReadRate(
      fakeClient([
        ev('a', 'delivered', '2026-08-30T23:00:00.000Z'), // dentro
        ev('a', 'read', '2026-08-31T01:00:00.000Z'), // fora do período, dentro das 24h
      ]),
      TENANT,
      { since: SINCE, until: UNTIL },
    )
    expect(r.entregues).toBe(1)
    expect(r.lidos24h).toBe(1)
  })

  it('entrega fora do período não entra, mesmo que a leitura caia dentro', async () => {
    const r = await getWhatsAppReadRate(
      fakeClient([
        ev('a', 'delivered', '2026-07-31T23:00:00.000Z'), // antes do since
        ev('a', 'read', '2026-08-01T01:00:00.000Z'),
      ]),
      TENANT,
      { since: SINCE, until: UNTIL },
    )
    expect(r.entregues).toBe(0)
    expect(r.taxa).toBeNull()
  })

  /**
   * A Evolution nem sempre emite `delivered`. Ler implica ter recebido —
   * exigir o ACK explícito jogaria fora leitura confirmada.
   */
  it('trata read sem delivered como entregue, ancorado no sent', async () => {
    const r = await getWhatsAppReadRate(
      fakeClient([
        ev('a', 'sent', '2026-08-10T10:00:00.000Z'),
        ev('a', 'read', '2026-08-10T11:00:00.000Z'),
      ]),
      TENANT,
      { since: SINCE, until: UNTIL },
    )
    expect(r.entregues).toBe(1)
    expect(r.lidos24h).toBe(1)
    expect(r.enviadosSemEntrega).toBe(0)
  })

  it('read isolado, sem sent nem delivered, conta como lido na hora', async () => {
    const r = await getWhatsAppReadRate(
      fakeClient([ev('a', 'read', '2026-08-10T11:00:00.000Z')]),
      TENANT,
      { since: SINCE, until: UNTIL },
    )
    expect(r.entregues).toBe(1)
    expect(r.lidos24h).toBe(1)
  })

  it('só sent conta em enviadosSemEntrega e fica fora da taxa', async () => {
    const r = await getWhatsAppReadRate(
      fakeClient([ev('a', 'sent', '2026-08-10T10:00:00.000Z')]),
      TENANT,
      { since: SINCE, until: UNTIL },
    )
    expect(r.entregues).toBe(0)
    expect(r.enviadosSemEntrega).toBe(1)
    expect(r.taxa).toBeNull()
  })

  /**
   * A tabela grava confirmação repetida de propósito (é log de retentativa).
   * A métrica reduz pelo evento mais antigo — a primeira notícia data o fato.
   */
  it('confirmação duplicada não infla o denominador nem move a janela', async () => {
    const r = await getWhatsAppReadRate(
      fakeClient([
        ev('a', 'delivered', '2026-08-10T10:00:00.000Z'),
        ev('a', 'delivered', '2026-08-10T10:00:00.000Z'),
        ev('a', 'delivered', '2026-08-12T10:00:00.000Z'), // retentativa tardia
        ev('a', 'read', '2026-08-10T20:00:00.000Z'),
      ]),
      TENANT,
      { since: SINCE, until: UNTIL },
    )
    expect(r.entregues).toBe(1)
    expect(r.lidos24h).toBe(1)
  })

  it('evento de erro não vira entrega', async () => {
    const r = await getWhatsAppReadRate(
      fakeClient([ev('a', 'error', '2026-08-10T10:00:00.000Z')]),
      TENANT,
      { since: SINCE, until: UNTIL },
    )
    expect(r.entregues).toBe(0)
    expect(r.enviadosSemEntrega).toBe(0)
    expect(r.taxa).toBeNull()
  })

  /** Zero entrega devolve null, não 0 — ver o comentário do campo `taxa`. */
  it('período sem entrega devolve taxa null e alvo indeterminado', async () => {
    const r = await getWhatsAppReadRate(fakeClient([]), TENANT, { since: SINCE, until: UNTIL })
    expect(r.taxa).toBeNull()
    expect(r.atingiuAlvo).toBeNull()
  })

  it('apura o alvo de 70% na fronteira', async () => {
    const eventos: Evento[] = []
    // 10 entregues, 7 lidos em 24h → exatamente no alvo.
    for (let i = 0; i < 10; i++) {
      eventos.push(ev(`r${i}`, 'delivered', `2026-08-10T10:0${i}:00.000Z`))
      if (i < 7) eventos.push(ev(`r${i}`, 'read', `2026-08-10T12:0${i}:00.000Z`))
    }
    const r = await getWhatsAppReadRate(fakeClient(eventos), TENANT, {
      since: SINCE,
      until: UNTIL,
    })
    expect(r.entregues).toBe(10)
    expect(r.lidos24h).toBe(7)
    expect(r.taxa).toBeCloseTo(ALVO_LEITURA_24H, 10)
    expect(r.atingiuAlvo).toBe(true)
  })

  it('rejeita período inválido em vez de devolver número silencioso', async () => {
    await expect(
      getWhatsAppReadRate(fakeClient([]), TENANT, { since: 'nao-e-data', until: UNTIL }),
    ).rejects.toThrow(/período inválido/)
  })
})

/**
 * Feature 051 — T053 — apuração do SC-004.
 *
 * SC-004: "≥ 70% dos lembretes ENTREGUES são lidos em até 24h".
 *
 * A métrica é DERIVADA de `whatsapp_delivery_events`, nunca persistida — pelo
 * mesmo motivo que a classificação de exame da 050 não é gravada: corrigir a
 * regra reapura o histórico inteiro sem reescrever registro nenhum. A tabela é
 * append-only e guarda o que o serviço nos contou; o que aquilo SIGNIFICA é
 * decisão de leitura.
 *
 * Três cuidados que a forma dos dados impõe:
 *
 * 1. **A janela é ancorada na entrega, e o lembrete é avaliado INTEIRO.** Um
 *    lembrete entregue às 23h do último dia pode ser lido às 1h do dia
 *    seguinte; um entregue no último dia do mês anterior pode ser lido no
 *    primeiro deste. Filtrar os eventos pelo período e apurar em cima do que
 *    sobrou erra dos dois lados: no fim, o lembrete entra no denominador e
 *    nunca no numerador (taxa cai por artefato de recorte); no início, um
 *    `read` órfão parece uma entrega deste período e é contado DUAS vezes — uma
 *    aqui, outra na apuração do período anterior.
 *
 *    Por isso a apuração é em dois passos: primeiro descobrimos QUAIS lembretes
 *    podem pertencer ao período, depois lemos o histórico COMPLETO de cada um e
 *    só então decidimos. Um lembrete nunca é julgado por um pedaço da sua
 *    própria linha do tempo.
 *
 * 2. **`read` sem `delivered` é entrega.** A Evolution nem sempre emite os dois
 *    ACKs; ler implica ter recebido. Nesses casos a linha de base vira o `sent`
 *    (e, na falta dele, o próprio `read`, o que dá diferença zero). Exigir um
 *    `delivered` explícito jogaria fora leitura confirmada.
 *
 * 3. **Confirmação duplicada não infla nada.** A tabela grava a mesma
 *    confirmação duas vezes de propósito (é log). Aqui reduzimos por lembrete,
 *    sempre pelo evento MAIS ANTIGO de cada status — a primeira notícia é a que
 *    data o fato.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

const VINTE_E_QUATRO_HORAS_MS = 24 * 3600_000
const PAGINA = 1000
const BLOCO_IDS = 200

export interface WhatsAppReadRateInput {
  /** Início do período (inclusivo), ISO. */
  since: string
  /** Fim do período (exclusivo), ISO. */
  until: string
}

export interface WhatsAppReadRateResult {
  /** Lembretes com entrega confirmada no período — o denominador do SC-004. */
  entregues: number
  /** Destes, os lidos em até 24h da entrega — o numerador. */
  lidos24h: number
  /** Lidos, mas depois da janela de 24h. Fora do SC-004, útil para diagnóstico. */
  lidosDepois: number
  /**
   * Proporção `lidos24h / entregues`, de 0 a 1. **`null` quando não houve
   * entrega alguma** — e não 0. Zero afirmaria "ninguém leu"; a ausência de
   * dado não afirma nada, e exibir 0% num período sem envio faria a clínica
   * achar que a feature está quebrada.
   */
  taxa: number | null
  /** `true` quando `taxa` atinge o alvo de 70%. `null` se não há o que apurar. */
  atingiuAlvo: boolean | null
  /** Lembretes com envio confirmado mas nenhuma entrega — sinal operacional. */
  enviadosSemEntrega: number
}

/** O alvo do SC-004, em proporção. */
export const ALVO_LEITURA_24H = 0.7

interface EventoBruto {
  reminder_id: string
  status: string
  occurred_at: string
}

/**
 * Apura o SC-004 para uma clínica num período.
 *
 * Requer client com acesso a `whatsapp_delivery_events` do tenant (service-role
 * ou sessão do próprio tenant — a RLS da 0185 já restringe o SELECT ao
 * `jwt_tenant_id()`). O `tenantId` vai explícito no filtro de qualquer forma:
 * métrica que depende só da RLS silencia em vez de errar quando o client muda.
 */
export async function getWhatsAppReadRate(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  input: WhatsAppReadRateInput,
): Promise<WhatsAppReadRateResult> {
  const inicio = new Date(input.since).getTime()
  const fim = new Date(input.until).getTime()
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) {
    throw new Error('getWhatsAppReadRate: período inválido')
  }

  // Passo 1 — candidatos. Qualquer lembrete com evento entre o início do
  // período e 24h além do fim PODE pertencer a ele. A cauda de 24h cobre a
  // leitura que atravessa a virada; quem entrou por engano cai no passo 2.
  const tetoBusca = new Date(fim + VINTE_E_QUATRO_HORAS_MS).toISOString()
  const candidatos = new Set(
    (await carregarEventos(supabase, tenantId, input.since, tetoBusca)).map((e) => e.reminder_id),
  )
  if (candidatos.size === 0) return vazio()

  // Passo 2 — histórico COMPLETO dos candidatos, sem filtro de tempo. É o que
  // permite descobrir que um `read` de 1º de agosto pertence a uma entrega de
  // 31 de julho — e portanto não é deste período. Ver cuidado (1).
  const eventos = await carregarEventosDe(supabase, tenantId, [...candidatos])

  // Primeiro evento de cada status, por lembrete — ver cuidado (3).
  const primeiro = new Map<string, { sent?: number; delivered?: number; read?: number }>()
  for (const ev of eventos) {
    if (ev.status !== 'sent' && ev.status !== 'delivered' && ev.status !== 'read') continue
    const ts = new Date(ev.occurred_at).getTime()
    if (!Number.isFinite(ts)) continue
    const atual = primeiro.get(ev.reminder_id) ?? {}
    const chave = ev.status as 'sent' | 'delivered' | 'read'
    if (atual[chave] === undefined || ts < (atual[chave] as number)) {
      atual[chave] = ts
      primeiro.set(ev.reminder_id, atual)
    }
  }

  let entregues = 0
  let lidos24h = 0
  let lidosDepois = 0
  let enviadosSemEntrega = 0

  for (const marcos of primeiro.values()) {
    // Base da entrega: `delivered` quando existe; senão, `read` implica entrega
    // e o `sent` data o fato — ver cuidado (2).
    const base =
      marcos.delivered ?? (marcos.read !== undefined ? (marcos.sent ?? marcos.read) : undefined)

    if (base === undefined) {
      // Só houve `sent`: saiu do nosso lado, ninguém confirmou recebimento.
      if (marcos.sent !== undefined && marcos.sent >= inicio && marcos.sent < fim) {
        enviadosSemEntrega++
      }
      continue
    }

    // O período recorta pela ENTREGA. A cauda de 24h da busca serve só para
    // achar a leitura; entrega fora do período não é deste período.
    if (base < inicio || base >= fim) continue

    entregues++
    if (marcos.read === undefined) continue
    if (marcos.read - base <= VINTE_E_QUATRO_HORAS_MS) lidos24h++
    else lidosDepois++
  }

  const taxa = entregues > 0 ? lidos24h / entregues : null
  return {
    entregues,
    lidos24h,
    lidosDepois,
    taxa,
    atingiuAlvo: taxa === null ? null : taxa >= ALVO_LEITURA_24H,
    enviadosSemEntrega,
  }
}

function vazio(): WhatsAppReadRateResult {
  return {
    entregues: 0,
    lidos24h: 0,
    lidosDepois: 0,
    taxa: null,
    atingiuAlvo: null,
    enviadosSemEntrega: 0,
  }
}

/**
 * Pagina explicitamente. O PostgREST corta em 1000 linhas por padrão, e uma
 * clínica com movimento passa disso em um mês — sem paginar, a métrica sairia
 * silenciosamente subestimada, que é o pior tipo de erro numa medição.
 */
async function carregarEventos(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  desde: string,
  ate: string,
): Promise<EventoBruto[]> {
  const out: EventoBruto[] = []
  for (let offset = 0; ; offset += PAGINA) {
    const { data, error } = await supabase
      .from('whatsapp_delivery_events')
      .select('reminder_id, status, occurred_at')
      .eq('tenant_id', tenantId)
      .gte('occurred_at', desde)
      .lt('occurred_at', ate)
      .order('occurred_at', { ascending: true })
      .range(offset, offset + PAGINA - 1)
    if (error) throw new Error(`getWhatsAppReadRate failed: ${error.message}`)
    const pagina = (data ?? []) as unknown as EventoBruto[]
    out.push(...pagina)
    if (pagina.length < PAGINA) break
  }
  return out
}

/**
 * Histórico completo de um conjunto de lembretes, sem recorte temporal. O `.in`
 * vai em blocos porque a lista entra na querystring — um período movimentado
 * estouraria o limite de URL e a falha apareceria como erro de rede, longe da
 * causa.
 */
async function carregarEventosDe(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  reminderIds: string[],
): Promise<EventoBruto[]> {
  const out: EventoBruto[] = []
  for (let i = 0; i < reminderIds.length; i += BLOCO_IDS) {
    const bloco = reminderIds.slice(i, i + BLOCO_IDS)
    for (let offset = 0; ; offset += PAGINA) {
      const { data, error } = await supabase
        .from('whatsapp_delivery_events')
        .select('reminder_id, status, occurred_at')
        .eq('tenant_id', tenantId)
        .in('reminder_id', bloco)
        .order('occurred_at', { ascending: true })
        .range(offset, offset + PAGINA - 1)
      if (error) throw new Error(`getWhatsAppReadRate failed: ${error.message}`)
      const pagina = (data ?? []) as unknown as EventoBruto[]
      out.push(...pagina)
      if (pagina.length < PAGINA) break
    }
  }
  return out
}

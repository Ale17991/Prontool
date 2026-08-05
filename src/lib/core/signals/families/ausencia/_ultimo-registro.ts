/**
 * Feature 053 — o predicado compartilhado das ausências "faz tempo que não vejo".
 *
 * Quatro famílias têm exatamente a mesma forma: pegar a linha mais recente de
 * uma tabela por paciente e perguntar se passou tempo demais. Escrever isso
 * quatro vezes garantiria que uma delas divergisse na próxima correção — e a
 * divergência apareceria como uma família que cobra em dia errado, sem erro
 * nenhum no log.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { toDayNumber } from '@/lib/core/habits/period'
import type { SignalCandidate } from '../../types'

export interface UltimoRegistroInput {
  supabase: SupabaseClient<Database>
  tenantId: string
  patientIds: string[]
  cycleDate: string
  /** Tabela a consultar. */
  tabela: 'patient_measurements' | 'food_recalls' | 'nutrition_assessments' | 'diet_plan_prescriptions'
  /** Coluna de data que ordena o "mais recente". */
  colunaData: string
  /** Filtro extra opcional (ex.: metric_type). */
  filtro?: { coluna: string; valor: string }
  /** Limite em dias OU meses — a unidade muda a conta e a mensagem. */
  limite: { dias: number } | { meses: number }
  /** Valores extras para os placeholders do texto. */
  valoresExtras?: Record<string, string>
}

/**
 * Pacientes cuja última linha é mais antiga que o limite.
 *
 * **Paciente sem nenhuma linha NÃO entra.** Nunca ter registrado uma medição é
 * diferente de ter parado de registrar: o primeiro é alguém que a clínica ainda
 * não pediu nada, o segundo é quem estava no caminho e saiu. Cobrar o primeiro
 * é mandar uma cobrança sobre um combinado que nunca existiu.
 */
export async function pacientesComUltimoRegistroAntigo(
  input: UltimoRegistroInput,
): Promise<SignalCandidate[]> {
  if (input.patientIds.length === 0) return []

  let query = input.supabase
    .from(input.tabela)
    .select(`patient_id, ${input.colunaData}`)
    .eq('tenant_id', input.tenantId)
    .in('patient_id', input.patientIds)
    .order(input.colunaData, { ascending: false })

  if (input.filtro) query = query.eq(input.filtro.coluna, input.filtro.valor) as typeof query

  const { data, error } = await query
  if (error) throw new Error(`${input.tabela}: ${error.message}`)

  // A lista vem do mais recente para o mais antigo: a primeira linha de cada
  // paciente é a que interessa.
  const ultimo = new Map<string, string>()
  for (const row of (data ?? []) as unknown as Array<Record<string, string>>) {
    const pid = row.patient_id as string
    if (!ultimo.has(pid)) ultimo.set(pid, String(row[input.colunaData]).slice(0, 10))
  }

  const out: SignalCandidate[] = []

  for (const [patientId, data0] of ultimo) {
    const decorrido = 'dias' in input.limite
      ? toDayNumber(input.cycleDate) - toDayNumber(data0)
      : mesesEntre(data0, input.cycleDate)

    const limite = 'dias' in input.limite ? input.limite.dias : input.limite.meses
    if (decorrido < limite) continue

    out.push({
      patientId,
      observed: { ultimoRegistro: data0, decorrido, limite, tabela: input.tabela },
      values: {
        ...(input.valoresExtras ?? {}),
        ...('dias' in input.limite
          ? { dias: String(decorrido) }
          : { meses: String(decorrido) }),
      },
    })
  }

  return out
}

/**
 * Meses completos entre duas datas, por calendário e não por "30 dias". Quem
 * foi atendido em 31/01 completa um mês em 28/02, e somar dias fixos iria
 * escorregando mês a mês até a mensagem chegar na semana errada.
 */
export function mesesEntre(inicioIso: string, fimIso: string): number {
  const [a0, m0, d0] = inicioIso.split('-').map(Number) as [number, number, number]
  const [a1, m1, d1] = fimIso.split('-').map(Number) as [number, number, number]
  const bruto = (a1 - a0) * 12 + (m1 - m0)
  return d1 < d0 ? bruto - 1 : bruto
}

/** `peso_corporal` → `peso corporal`. O paciente não lê snake_case. */
export function rotuloMetrica(metricType: string): string {
  return metricType.replace(/_/g, ' ')
}

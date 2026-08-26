/**
 * Feature 056 — reengajamento de quem parou de abrir o portal.
 *
 * A fonte veio da 053, que a desenhou com a prioridade mais alta entre as de
 * ausência por um motivo estrutural: ela atende exatamente quem as outras
 * suprimiriam. As fontes que dependem de atividade no portal — recordatório,
 * checklist — deixam de enxergar quem sumiu, e sem esta o paciente que mais
 * precisa de um empurrão seria o único a não receber nada.
 *
 * O motor da 056 não tem hierarquia de prioridade entre fontes, e não precisa
 * ter: cada automação é avaliada por si, e o teto por paciente/dia já impede a
 * rajada. O que a 053 resolvia com precedência, aqui resolve-se ligando a
 * automação — e é por isso que ela cabe no modelo sem trazer o conceito junto.
 */

import { z } from 'zod'
import { registerSource } from './registry'
import { addDias, dataCivilBr, eligiblePatients, pageAll } from './shared'
import type { EnumerateContext, SourceCandidate } from '../types'

type Resposta = { data: unknown; error: { message: string } | null }

registerSource({
  id: 'sem_acesso_portal',
  label: 'Sem abrir o portal há N dias',
  group: 'relacionamento',
  requiresModule: 'portal_paciente',
  hint: 'Dispara para quem já entrou no portal alguma vez e está há N dias sem abrir. Repete no máximo uma vez por mês.',
  /**
   * O aviso existe porque o dado é MAIS estreito do que parece: a trilha
   * registra acesso ao portal, e não contato com a clínica. Quem liga, manda
   * mensagem e comparece à consulta toda semana aparece aqui como "sumido".
   */
  warning:
    'O sistema sabe que o PORTAL não foi aberto — não que o paciente sumiu. Quem telefona ou vem à clínica também entra nesta lista. Escreva como convite, nunca como "faz tempo que você não aparece".',
  paramsSchema: z.object({ dias: z.number().int().min(7).max(365) }).strict(),
  fields: [
    {
      name: 'dias',
      label: 'Dias sem abrir o portal',
      kind: 'number',
      min: 7,
      max: 365,
      defaultValue: 30,
      hint: 'Mínimo de 7 dias: abaixo disso alcança quem simplesmente passou a semana sem precisar do portal.',
    },
  ],
  variables: ['dias', 'ultimo_acesso'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const { dias } = ctx.params as { dias: number }
    const aptos = await eligiblePatients(ctx)
    if (aptos.size === 0) return []

    const acessos = await pageAll<{ patient_id: string; created_at: string }>(
      (from, to) =>
        ctx.supabase
          .from('patient_portal_access_log')
          .select('patient_id, created_at')
          .eq('tenant_id', ctx.tenantId)
          .order('patient_id')
          .range(from, to) as unknown as PromiseLike<Resposta>,
      'sem_acesso_portal',
    )

    const ultimo = new Map<string, string>()
    for (const a of acessos) {
      const quando = (a.created_at ?? '').slice(0, 10)
      if (!a.patient_id || !quando) continue
      const atual = ultimo.get(a.patient_id)
      if (!atual || quando > atual) ultimo.set(a.patient_id, quando)
    }

    const corte = addDias(ctx.today, -dias)
    const out: SourceCandidate[] = []
    for (const [patientId, quando] of ultimo) {
      if (!aptos.has(patientId)) continue
      if (quando > corte) continue

      /**
       * QUEM NUNCA ENTROU NÃO ESTÁ AQUI, e é de propósito: o mapa só tem quem
       * tem trilha. Quem jamais abriu o portal não sumiu — nunca chegou. É
       * outro público, e "faz tempo que não vemos você por aqui" para quem
       * nunca esteve soa como mensagem trocada, porque é. Se a clínica quiser
       * convidar esse grupo, o convite é outro texto e vira outra fonte.
       */
      out.push({
        patientId,
        // Mensal: o estado é contínuo e não se resolve sozinho.
        occurrenceKey: ctx.today.slice(0, 7),
        variables: { dias: String(dias), ultimo_acesso: dataCivilBr(quando) },
      })
    }
    return out
  },
})

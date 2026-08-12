/**
 * Feature 056 — o registro consultável de ocorrências (FR-019).
 *
 * Cada avaliação que resultou em envio, supressão ou impedimento vira uma linha
 * aqui, com o motivo. Sem esta rota o registro existia no banco e não existia
 * para a clínica — e a pergunta que ela realmente faz ("por que fulano não
 * recebeu?") só teria resposta por consulta manual ao Postgres.
 *
 * O NOME DO PACIENTE é decifrado aqui, e é o único dado sensível que a rota
 * devolve: sem ele a tela mostraria uma coluna de uuid, que não responde a
 * pergunta nenhuma. A decifra usa a RPC de sempre, com a chave do ambiente, e
 * só para as linhas da página pedida.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { toHttpResponse } from '@/lib/observability/http'
import { hasAutomationsModule, moduleDisabled } from '@/lib/core/automations/gate'
import { resolveAutomationDeliveryStatuses } from '@/lib/core/whatsapp/delivery'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  automacao: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
})

export async function GET(req: Request): Promise<Response> {
  const route = '/api/automacoes/ocorrencias'
  try {
    const session = await requireRole(['admin'], {
      entity: 'automation_occurrences',
      route,
      request: req,
    })
    if (!(await hasAutomationsModule(session.tenantId))) return moduleDisabled()

    const url = new URL(req.url)
    const parsed = querySchema.safeParse({
      automacao: url.searchParams.get('automacao') ?? undefined,
      limite: url.searchParams.get('limite') ?? undefined,
    })
    if (!parsed.success) return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 400 })

    const supabase = createSupabaseServiceClient()

    let q = supabase
      .from('automation_occurrences')
      .select(
        `id, patient_id, occurrence_key, outcome, reason, created_at,
         automations!inner(id, automation_triggers!inner(name), message_templates!inner(name))`,
      )
      .eq('tenant_id', session.tenantId)
      .order('created_at', { ascending: false })
      .limit(parsed.data.limite)
    if (parsed.data.automacao) q = q.eq('automation_id', parsed.data.automacao)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    const linhas = (data ?? []) as unknown as Array<{
      id: string
      patient_id: string
      occurrence_key: string
      outcome: string
      reason: string | null
      created_at: string
      automations: {
        id: string
        automation_triggers: { name: string }
        message_templates: { name: string }
      }
    }>

    // Nomes em UMA chamada, não uma por linha. A RPC dedicada existe desde a
    // 019 justamente para telas que listam pacientes.
    const nomes = new Map<string, string>()
    const ids = [...new Set(linhas.map((l) => l.patient_id))]
    if (ids.length > 0) {
      const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
      if (key) {
        const { data: dec } = await supabase.rpc('decrypt_patient_names_for_ids', {
          p_tenant_id: session.tenantId,
          p_patient_ids: ids,
          p_key: key,
        } as never)
        for (const r of (dec ?? []) as Array<{
          id: string
          full_name: string | null
          anonymized_at: string | null
        }>) {
          // Paciente anonimizado depois do envio: o histórico registra que a
          // mensagem saiu, mas o nome não volta. Mostrar o uuid seria pior que
          // dizer o que aconteceu.
          if (r.anonymized_at) nomes.set(r.id, 'Paciente anonimizado')
          else if (r.full_name) nomes.set(r.id, r.full_name)
        }
      }
    }

    // Entrega e leitura são estado de LEITURA, resolvido por precedência de
    // rank — nunca coluna gravada na ocorrência.
    const entregas = await resolveAutomationDeliveryStatuses(
      supabase as never,
      session.tenantId,
      linhas.filter((l) => l.outcome === 'enviado').map((l) => l.id),
    ).catch(() => new Map<string, string>())

    return NextResponse.json(
      {
        ocorrencias: linhas.map((l) => ({
          id: l.id,
          quando: l.created_at,
          paciente: nomes.get(l.patient_id) ?? null,
          automacao: `${l.automations.automation_triggers.name} → ${l.automations.message_templates.name}`,
          automacaoId: l.automations.id,
          chave: l.occurrence_key,
          desfecho: l.outcome,
          motivo: l.reason,
          entrega: entregas.get(l.id) ?? null,
        })),
      },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

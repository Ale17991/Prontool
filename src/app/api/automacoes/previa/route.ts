/**
 * Feature 056 — prévia por FONTE E PARÂMETROS, antes de existir gatilho.
 *
 * A rota irmã (`/api/automacoes/gatilhos/[id]/previa`) responde sobre um gatilho
 * já gravado, e continua servindo a quem tem um. Esta responde enquanto a
 * clínica ainda está escolhendo o intervalo — que é quando a resposta muda a
 * decisão. Perguntar "quantos isso pega?" só depois de gravar inverteria a ordem
 * do cuidado, e o aviso de volume chegaria com a escolha já feita.
 *
 * É POST porque o corpo é a configuração inteira da fonte (parâmetros
 * aninhados), não um identificador — e porque nada é criado, o 200 devolve
 * contagem e nada mais.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { toHttpResponse } from '@/lib/observability/http'
import { hasAutomationsModule, moduleDisabled } from '@/lib/core/automations/gate'
import { previewSource } from '@/lib/core/automations/preview'
import { getSource } from '@/lib/core/automations/sources'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  source: z.string().trim().min(1).max(60),
  params: z.record(z.unknown()).default({}),
})

export async function POST(req: Request): Promise<Response> {
  const route = '/api/automacoes/previa'
  try {
    const session = await requireRole(['admin'], {
      entity: 'automations',
      route,
      request: req,
    })
    if (!(await hasAutomationsModule(session.tenantId))) return moduleDisabled()

    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 400 })

    const fonte = getSource(parsed.data.source)
    if (!fonte) return NextResponse.json({ error: 'FONTE_DESCONHECIDA' }, { status: 400 })

    const supabase = createSupabaseServiceClient()

    // A prévia LÊ dado de vertical (agenda, financeiro, checklist). O gate de
    // módulo vale aqui pelo mesmo motivo que vale na criação: a rota é chamável
    // direto, e contar pacientes de um módulo não contratado já é ler o que não
    // foi vendido.
    if (fonte.requiresModule) {
      const ent = await getTenantEntitlements(supabase, session.tenantId)
      if (!ent.hasModule(fonte.requiresModule as never)) {
        return NextResponse.json({ error: 'FONTE_INDISPONIVEL' }, { status: 403 })
      }
    }

    const v = fonte.paramsSchema.safeParse(parsed.data.params)
    if (!v.success) {
      return NextResponse.json(
        { error: 'PARAMETROS_INVALIDOS', detail: v.error.issues[0]?.message ?? 'inválido' },
        { status: 400 },
      )
    }

    const previa = await previewSource(
      supabase,
      session.tenantId,
      parsed.data.source,
      v.data as Record<string, unknown>,
    )
    return NextResponse.json(previa, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

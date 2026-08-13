/**
 * Feature 056 — quando as automações podem sair (migration 0201).
 *
 * Janela de horário e dias da semana permitidos, por clínica. É a única
 * configuração da feature que não pertence a uma automação específica: ela vale
 * para todas, porque a pergunta que responde é sobre o NÚMERO da clínica, não
 * sobre uma mensagem — e é o número que é bloqueado quando o padrão de envio
 * parece disparo em massa.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { toHttpResponse } from '@/lib/observability/http'
import { hasAutomationsModule, moduleDisabled } from '@/lib/core/automations/gate'
import { auditAutomation } from '@/lib/core/automations/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

const patchSchema = z
  .object({
    janelaInicio: z.string().regex(HORA, 'horário deve ser HH:MM'),
    janelaFim: z.string().regex(HORA, 'horário deve ser HH:MM'),
    /**
     * Dias PERMITIDOS (0 = domingo). Aceita lista vazia de propósito: "não
     * enviar em dia nenhum" é uma forma legítima de pausar tudo sem desligar
     * automação por automação, e recusá-la obrigaria a clínica a desligar sete
     * coisas para conseguir o mesmo silêncio.
     */
    dias: z.array(z.number().int().min(0).max(6)).max(7),
  })
  .refine((v) => v.janelaFim > v.janelaInicio, {
    message: 'o fim da janela precisa ser depois do início',
  })

export async function PATCH(req: Request): Promise<Response> {
  const route = '/api/automacoes/configuracao'
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_clinic_profile',
      route,
      request: req,
    })
    if (!(await hasAutomationsModule(session.tenantId))) return moduleDisabled()

    const parsed = patchSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'PAYLOAD_INVALIDO', detail: parsed.error.issues[0]?.message },
        { status: 400 },
      )
    }

    // Duplicata some: a mesma segunda-feira marcada duas vezes viraria um array
    // com repetição, que passa no CHECK do banco e polui a leitura.
    const dias = [...new Set(parsed.data.dias)].sort((a, b) => a - b)

    const supabase = createSupabaseServiceClient()
    const { error } = await supabase
      .from('tenant_clinic_profile')
      // `as never` porque os tipos gerados são de antes da 0201. Regerar
      // (`pnpm supabase:gen-types`) exige o stack local de pé.
      .update({
        automation_window_start: parsed.data.janelaInicio,
        automation_window_end: parsed.data.janelaFim,
        automation_weekdays: dias,
      } as never)
      .eq('tenant_id', session.tenantId)
    if (error) throw new Error(error.message)

    await auditAutomation(supabase, {
      tenantId: session.tenantId,
      entity: 'tenant_clinic_profile',
      entityId: session.tenantId,
      field: 'automation_send_window',
      newValue: `${parsed.data.janelaInicio}-${parsed.data.janelaFim} dias=[${dias.join(',')}]`,
      reason: 'Janela de envio das automações alterada',
    })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/lib/db/types'
import { TISS_VERSION } from './version'
import { recordTissAudit } from './audit'

/**
 * Feature 029 (US1) — configuração TISS por operadora (1:1 com `health_plans`).
 * Registro ANS + código do contratado + CNPJ/CNES + mapeamentos. Habilita o
 * convênio para faturamento TISS. Escrita admin-only (RLS + requireRole).
 */

const onlyDigits = (v: string) => v.replace(/\D/g, '')

export const tissOperatorConfigSchema = z.object({
  ans_registration: z
    .string()
    .transform(onlyDigits)
    .refine((v) => v.length === 6, 'Registro ANS deve ter 6 dígitos'),
  tiss_version: z.string().default(TISS_VERSION),
  contracted_code: z.string().trim().min(1, 'Código do contratado é obrigatório'),
  contracted_cnpj: z
    .string()
    .transform(onlyDigits)
    .refine((v) => v.length === 14, 'CNPJ do contratado deve ter 14 dígitos'),
  contracted_cnes: z
    .string()
    .transform(onlyDigits)
    .refine((v) => v.length === 0 || v.length === 7, 'CNES deve ter 7 dígitos')
    .optional(),
  procedure_table_map: z.record(z.string(), z.string()).default({}),
})

export type TissOperatorConfigInput = z.input<typeof tissOperatorConfigSchema>
export type TissOperatorConfig = z.infer<typeof tissOperatorConfigSchema>

export interface UpsertOperatorConfigArgs {
  supabase: SupabaseClient<Database>
  tenantId: string
  healthPlanId: string
  config: TissOperatorConfig
  actorUserId: string
  actorLabel: string
  ip?: string | null
  userAgent?: string | null
}

export async function upsertTissOperatorConfig(
  args: UpsertOperatorConfigArgs,
): Promise<{ id: string }> {
  const { supabase, tenantId, healthPlanId, config } = args
  const { data, error } = await supabase
    .from('tenant_tiss_operator_config')
    .upsert(
      {
        tenant_id: tenantId,
        health_plan_id: healthPlanId,
        ans_registration: config.ans_registration,
        tiss_version: config.tiss_version,
        contracted_code: config.contracted_code,
        contracted_cnpj: config.contracted_cnpj,
        contracted_cnes: config.contracted_cnes && config.contracted_cnes.length > 0
          ? config.contracted_cnes
          : null,
        procedure_table_map: config.procedure_table_map,
        active: true,
        created_by_user_id: args.actorUserId,
      },
      { onConflict: 'tenant_id,health_plan_id' },
    )
    .select('id')
    .single()
  if (error) throw new Error(`upsertTissOperatorConfig failed: ${error.message}`)

  await recordTissAudit(supabase, {
    tenantId,
    actorUserId: args.actorUserId,
    actorLabel: args.actorLabel,
    entity: 'tenant_tiss_operator_config',
    entityId: data.id,
    field: 'tiss.operator.configure',
    detail: { health_plan_id: healthPlanId, ans_registration: config.ans_registration },
    reason: 'admin configurou faturamento TISS da operadora',
    ip: args.ip,
    userAgent: args.userAgent,
  })
  return { id: data.id }
}

export async function getTissOperatorConfig(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  healthPlanId: string,
): Promise<Database['public']['Tables']['tenant_tiss_operator_config']['Row'] | null> {
  const { data, error } = await supabase
    .from('tenant_tiss_operator_config')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('health_plan_id', healthPlanId)
    .maybeSingle()
  if (error) throw new Error(`getTissOperatorConfig failed: ${error.message}`)
  return data
}

export interface DeactivateOperatorConfigArgs {
  supabase: SupabaseClient<Database>
  tenantId: string
  healthPlanId: string
  actorUserId: string
  actorLabel: string
  ip?: string | null
  userAgent?: string | null
}

export async function deactivateTissOperatorConfig(
  args: DeactivateOperatorConfigArgs,
): Promise<{ active: false }> {
  const { supabase, tenantId, healthPlanId } = args
  const { error } = await supabase
    .from('tenant_tiss_operator_config')
    .update({ active: false })
    .eq('tenant_id', tenantId)
    .eq('health_plan_id', healthPlanId)
  if (error) throw new Error(`deactivateTissOperatorConfig failed: ${error.message}`)

  await recordTissAudit(supabase, {
    tenantId,
    actorUserId: args.actorUserId,
    actorLabel: args.actorLabel,
    entity: 'tenant_tiss_operator_config',
    entityId: healthPlanId,
    field: 'tiss.operator.deactivate',
    reason: 'admin desabilitou faturamento TISS da operadora',
    ip: args.ip,
    userAgent: args.userAgent,
  })
  return { active: false }
}

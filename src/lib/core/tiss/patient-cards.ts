/**
 * Feature 029 (US2/T026) — carteira do beneficiário por operadora.
 *
 * 1 paciente × N convênios. `card_number_enc` é cifrado via `enc_text_with_key`
 * (mesma chave/padrão do resto da PII) e NUNCA volta ao browser em claro — só o
 * servidor decifra (em `build-guia`) para montar a guia.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { recordTissAudit } from './audit'

type Client = SupabaseClient<Database>

function encKey(): string {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY not set')
  return key
}

async function encText(supabase: Client, plain: string): Promise<string> {
  const { data, error } = await supabase.rpc('enc_text_with_key', { plain, key: encKey() })
  if (error) throw new Error(`enc_text_with_key failed: ${error.message}`)
  return data as unknown as string
}

async function decText(supabase: Client, cipher: string): Promise<string> {
  const { data, error } = await supabase.rpc('dec_text_with_key', { cipher, key: encKey() })
  if (error) throw new Error(`dec_text_with_key failed: ${error.message}`)
  return (data as unknown as string) ?? ''
}

export interface UpsertCardArgs {
  supabase: Client
  tenantId: string
  patientId: string
  healthPlanId: string
  cardNumber: string
  cardValidUntil?: string | null
  actorUserId: string
  actorLabel: string
  ip?: string | null
  userAgent?: string | null
}

/** Cria/atualiza a carteira do beneficiário (cifra o número). */
export async function upsertPatientCard(args: UpsertCardArgs): Promise<{ id: string }> {
  const { supabase, tenantId, patientId, healthPlanId } = args
  const cardEnc = await encText(supabase, args.cardNumber.trim())
  const { data, error } = await supabase
    .from('patient_health_plan_cards')
    .upsert(
      {
        tenant_id: tenantId,
        patient_id: patientId,
        health_plan_id: healthPlanId,
        card_number_enc: cardEnc as unknown as string,
        card_valid_until: args.cardValidUntil ?? null,
        created_by_user_id: args.actorUserId,
      },
      { onConflict: 'tenant_id,patient_id,health_plan_id' },
    )
    .select('id')
    .single()
  if (error) throw new Error(`upsertPatientCard failed: ${error.message}`)

  await recordTissAudit(supabase, {
    tenantId,
    actorUserId: args.actorUserId,
    actorLabel: args.actorLabel,
    entity: 'patient_health_plan_cards',
    entityId: data.id,
    field: 'tiss.card.upsert',
    detail: { patient_id: patientId, health_plan_id: healthPlanId },
    reason: 'cadastro/atualização da carteira do beneficiário',
    ip: args.ip,
    userAgent: args.userAgent,
  })
  return { id: data.id }
}

export interface PatientCard {
  cardNumber: string
  cardValidUntil: string | null
}

/** Lê e decifra a carteira do paciente para uma operadora (server-side). */
export async function getPatientCard(
  supabase: Client,
  tenantId: string,
  patientId: string,
  healthPlanId: string,
): Promise<PatientCard | null> {
  const { data, error } = await supabase
    .from('patient_health_plan_cards')
    .select('card_number_enc, card_valid_until')
    .eq('tenant_id', tenantId)
    .eq('patient_id', patientId)
    .eq('health_plan_id', healthPlanId)
    .maybeSingle()
  if (error) throw new Error(`getPatientCard failed: ${error.message}`)
  if (!data) return null
  const cardNumber = await decText(supabase, data.card_number_enc as unknown as string)
  return { cardNumber, cardValidUntil: data.card_valid_until }
}

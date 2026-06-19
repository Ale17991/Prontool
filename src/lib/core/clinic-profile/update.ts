import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/lib/db/types'
import { ConflictError, ValidationError } from '@/lib/observability/errors'
import { isValidCnpj, stripCnpj } from './validate-cnpj'
import { getClinicProfile } from './read'
import { isBookingSlugTaken, normalizeBookingSlug } from './booking-slug'
import { COUNCIL_CODES, UF_CODES, type ClinicProfile } from './types'

const optionalString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : (v ?? undefined)))

export const clinicProfilePatchSchema = z.object({
  /** Feature 010 (US3 / R13) — alimenta `tenants.name`. */
  displayName: optionalString(200),
  corporateName: optionalString(200),
  cnpj: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v === null || v === undefined || v === '' ? null : stripCnpj(v)))
    .refine((v) => v === null || v === undefined || (v.length === 14 && isValidCnpj(v)), {
      message: 'CNPJ inválido',
      path: [],
    }),
  phone: optionalString(20),
  email: z
    .string()
    .trim()
    .max(200)
    .email()
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : (v ?? undefined))),
  address: z
    .object({
      cep: z
        .string()
        .nullable()
        .optional()
        .transform((v) => (v === null || v === undefined || v === '' ? null : v.replace(/\D+/g, '')))
        .refine((v) => v === null || v === undefined || /^[0-9]{8}$/.test(v), { message: 'CEP inválido' }),
      street: optionalString(200),
      number: optionalString(20),
      complement: optionalString(100),
      neighborhood: optionalString(100),
      city: optionalString(100),
      uf: z
        .string()
        .nullable()
        .optional()
        .transform((v) => (v === null || v === undefined || v === '' ? null : v.toUpperCase()))
        .refine((v) => v === null || v === undefined || (UF_CODES as readonly string[]).includes(v), {
          message: 'UF inválida',
        }),
    })
    .partial()
    .optional(),
  techResponsible: z
    .object({
      name: optionalString(200),
      council: z
        .string()
        .nullable()
        .optional()
        .transform((v) => (v === null || v === undefined || v === '' ? null : v.toUpperCase()))
        .refine((v) => v === null || v === undefined || (COUNCIL_CODES as readonly string[]).includes(v), {
          message: 'Conselho inválido',
        }),
      registration: optionalString(30),
    })
    .partial()
    .optional(),
  /**
   * Feature 017 — slug do portal público. Aceita string|null; formato,
   * reservados e unicidade são validados em `updateClinicProfile` (mensagens
   * amigáveis + checagem cross-tenant). '' / null → desativa o portal.
   */
  publicBookingSlug: z.string().nullable().optional(),
  /** Período (minutos) que cada linha da agenda representa (1–1440). */
  calendarSlotIntervalMinutes: z.number().int().min(1).max(1440).optional(),
  /** Horário de funcionamento — abertura/fechamento, 'HH:MM'. */
  calendarOpenTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido (HH:MM)')
    .optional(),
  calendarCloseTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido (HH:MM)')
    .optional(),
})

export type ClinicProfilePatch = z.infer<typeof clinicProfilePatchSchema>

const COLUMN_FOR_FIELD: Record<string, string> = {
  corporateName: 'corporate_name',
  cnpj: 'cnpj',
  phone: 'phone',
  email: 'email',
  'address.cep': 'address_cep',
  'address.street': 'address_street',
  'address.number': 'address_number',
  'address.complement': 'address_complement',
  'address.neighborhood': 'address_neighborhood',
  'address.city': 'address_city',
  'address.uf': 'address_uf',
  'techResponsible.name': 'tech_responsible_name',
  'techResponsible.council': 'tech_responsible_council',
  'techResponsible.registration': 'tech_responsible_registration',
}

function flattenPatch(patch: ClinicProfilePatch): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  if ('corporateName' in patch) out['corporateName'] = (patch.corporateName ?? null) as string | null
  if ('cnpj' in patch) out['cnpj'] = (patch.cnpj ?? null) as string | null
  if ('phone' in patch) out['phone'] = (patch.phone ?? null) as string | null
  if ('email' in patch) out['email'] = (patch.email ?? null) as string | null
  if (patch.address) {
    for (const k of Object.keys(patch.address)) {
      const value = (patch.address as Record<string, string | null>)[k]
      out[`address.${k}`] = value ?? null
    }
  }
  if (patch.techResponsible) {
    for (const k of Object.keys(patch.techResponsible)) {
      const value = (patch.techResponsible as Record<string, string | null>)[k]
      out[`techResponsible.${k}`] = value ?? null
    }
  }
  return out
}

interface UpdateContext {
  ip?: string | null
  userAgent?: string | null
  reason?: string
}

/**
 * Atualiza o perfil da clínica. Para cada campo alterado escreve uma linha
 * em `audit_log` (Constituição §II) com `old/new` antes do UPDATE final.
 * Retorna o perfil atualizado (mesma shape que `getClinicProfile`).
 */
export async function updateClinicProfile(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  actorId: string,
  patchInput: unknown,
  context: UpdateContext = {},
): Promise<ClinicProfile> {
  const parsed = clinicProfilePatchSchema.safeParse(patchInput)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new ValidationError(first?.message ?? 'invalid clinic profile patch', {
      issues: parsed.error.issues,
    })
  }
  const patch = parsed.data

  const current = await getClinicProfile(supabase, tenantId, 0)

  // Side-effect writes fora do flatten string-based (tenants.name, slug,
  // intervalo). Se algum ocorrer e o flatten ficar vazio, re-lemos no fim para
  // a resposta refletir a mudança (em vez de devolver o snapshot pré-update).
  let sideEffectWrite = false

  // Feature 010 (US3 / R13) — displayName escreve em tenants.name. Tratado
  // separadamente do flatten do tenant_clinic_profile.
  if ('displayName' in patch) {
    const newName = (patch.displayName ?? '').trim()
    const oldName = current.displayName ?? ''
    if (newName.length > 0 && newName !== oldName) {
      const { error: tenantUpdateErr } = await supabase
        .from('tenants')
        .update({ name: newName })
        .eq('id', tenantId)
      if (tenantUpdateErr) {
        throw new Error(`updateClinicProfile tenant.name update failed: ${tenantUpdateErr.message}`)
      }
      await supabase.from('audit_log').insert({
        tenant_id: tenantId,
        actor_id: actorId,
        actor_label: null,
        entity: 'tenants',
        entity_id: tenantId,
        field: 'name',
        old_value: oldName || null,
        new_value: newName,
        reason: context.reason ?? 'updated via /api/configuracoes/clinica PUT',
        ip: context.ip ?? null,
        user_agent: context.userAgent ?? null,
        result: 'success',
      })
      sideEffectWrite = true
    }
  }
  // Feature 017 — slug do portal público. Tratado à parte do flatten porque
  // exige validação amigável, checagem de unicidade cross-tenant e o
  // acoplamento com `public_booking_enabled` (CHECK: habilitado exige slug).
  if ('publicBookingSlug' in patch) {
    const check = normalizeBookingSlug(patch.publicBookingSlug ?? null)
    if (!check.ok) {
      throw new ValidationError(check.reason, { field: 'publicBookingSlug' })
    }
    const newSlug = check.slug
    const oldSlug = current.publicBookingSlug
    if (newSlug !== oldSlug) {
      if (newSlug !== null && (await isBookingSlugTaken(supabase, newSlug, tenantId))) {
        throw new ConflictError(
          'SLUG_ALREADY_TAKEN',
          'Este link já está em uso por outra clínica. Escolha outro.',
        )
      }
      type ProfileUpdate = Database['public']['Tables']['tenant_clinic_profile']['Update']
      const slugUpdate: ProfileUpdate = { public_booking_slug: newSlug }
      // Limpar o slug desativa o portal (satisfaz a CHECK enabled⇒slug).
      if (newSlug === null) slugUpdate.public_booking_enabled = false
      const { error: slugErr } = await supabase
        .from('tenant_clinic_profile')
        .update(slugUpdate)
        .eq('tenant_id', tenantId)
      if (slugErr) {
        throw new Error(`updateClinicProfile slug update failed: ${slugErr.message}`)
      }
      await supabase.from('audit_log').insert({
        tenant_id: tenantId,
        actor_id: actorId,
        actor_label: null,
        entity: 'tenant_clinic_profile',
        entity_id: tenantId,
        field: 'public_booking_slug',
        old_value: oldSlug,
        new_value: newSlug,
        reason: context.reason ?? 'updated via /api/configuracoes/clinica PUT',
        ip: context.ip ?? null,
        user_agent: context.userAgent ?? null,
        result: 'success',
      })
      sideEffectWrite = true
    }
  }

  // Intervalo de slot da agenda (numérico) — fora do flatten string-based.
  if ('calendarSlotIntervalMinutes' in patch && patch.calendarSlotIntervalMinutes !== undefined) {
    const newInterval = patch.calendarSlotIntervalMinutes
    const oldInterval = current.calendarSlotIntervalMinutes
    if (newInterval !== oldInterval) {
      type ProfileUpdate = Database['public']['Tables']['tenant_clinic_profile']['Update']
      const intervalUpdate: ProfileUpdate = { calendar_slot_interval_minutes: newInterval }
      const { error: intervalErr } = await supabase
        .from('tenant_clinic_profile')
        .update(intervalUpdate)
        .eq('tenant_id', tenantId)
      if (intervalErr) {
        throw new Error(`updateClinicProfile interval update failed: ${intervalErr.message}`)
      }
      await supabase.from('audit_log').insert({
        tenant_id: tenantId,
        actor_id: actorId,
        actor_label: null,
        entity: 'tenant_clinic_profile',
        entity_id: tenantId,
        field: 'calendar_slot_interval_minutes',
        old_value: String(oldInterval),
        new_value: String(newInterval),
        reason: context.reason ?? 'updated via /api/configuracoes/clinica PUT',
        ip: context.ip ?? null,
        user_agent: context.userAgent ?? null,
        result: 'success',
      })
      sideEffectWrite = true
    }
  }

  // Horário de funcionamento (janela do calendário). Tratado junto porque a
  // CHECK do banco exige abertura < fechamento — validamos com o valor atual
  // do campo que não veio no patch.
  if ('calendarOpenTime' in patch || 'calendarCloseTime' in patch) {
    const newOpen = patch.calendarOpenTime ?? current.calendarOpenTime
    const newClose = patch.calendarCloseTime ?? current.calendarCloseTime
    if (newOpen >= newClose) {
      throw new ValidationError('Horário de abertura deve ser antes do fechamento.', {
        field: 'calendarOpenTime',
      })
    }
    type ProfileUpdate = Database['public']['Tables']['tenant_clinic_profile']['Update']
    const winUpdate: ProfileUpdate = {}
    const winAudit: Array<{ field: string; oldValue: string; newValue: string }> = []
    if (newOpen !== current.calendarOpenTime) {
      winUpdate.calendar_open_time = newOpen
      winAudit.push({ field: 'calendar_open_time', oldValue: current.calendarOpenTime, newValue: newOpen })
    }
    if (newClose !== current.calendarCloseTime) {
      winUpdate.calendar_close_time = newClose
      winAudit.push({ field: 'calendar_close_time', oldValue: current.calendarCloseTime, newValue: newClose })
    }
    if (winAudit.length > 0) {
      const { error: winErr } = await supabase
        .from('tenant_clinic_profile')
        .update(winUpdate)
        .eq('tenant_id', tenantId)
      if (winErr) {
        throw new Error(`updateClinicProfile calendar window update failed: ${winErr.message}`)
      }
      for (const a of winAudit) {
        await supabase.from('audit_log').insert({
          tenant_id: tenantId,
          actor_id: actorId,
          actor_label: null,
          entity: 'tenant_clinic_profile',
          entity_id: tenantId,
          field: a.field,
          old_value: a.oldValue,
          new_value: a.newValue,
          reason: context.reason ?? 'updated via /api/configuracoes/clinica PUT',
          ip: context.ip ?? null,
          user_agent: context.userAgent ?? null,
          result: 'success',
        })
      }
      sideEffectWrite = true
    }
  }

  const flat = flattenPatch(patch)

  // Calcula diffs por campo e prepara payloads.
  type UpdateRow = Database['public']['Tables']['tenant_clinic_profile']['Update']
  const updates: UpdateRow = {}
  const auditRows: Array<{ field: string; oldValue: string | null; newValue: string | null }> = []
  for (const [logicalKey, newValue] of Object.entries(flat)) {
    const dbCol = COLUMN_FOR_FIELD[logicalKey] as keyof UpdateRow | undefined
    if (!dbCol) continue
    const oldValue = readLogicalKey(current, logicalKey)
    if (oldValue === newValue) continue
    ;(updates as Record<string, string | null>)[dbCol as string] = newValue
    auditRows.push({ field: dbCol as string, oldValue, newValue })
  }

  if (Object.keys(updates).length === 0) {
    return sideEffectWrite ? getClinicProfile(supabase, tenantId) : current
  }

  const { error: updateError } = await supabase
    .from('tenant_clinic_profile')
    .update(updates)
    .eq('tenant_id', tenantId)

  if (updateError) {
    throw new Error(`updateClinicProfile failed: ${updateError.message}`)
  }

  // Auditoria: 1 row por campo alterado.
  await Promise.all(
    auditRows.map(async ({ field, oldValue, newValue }) => {
      const { error } = await supabase.from('audit_log').insert({
        tenant_id: tenantId,
        actor_id: actorId,
        actor_label: null,
        entity: 'tenant_clinic_profile',
        entity_id: tenantId,
        field,
        old_value: oldValue,
        new_value: newValue,
        reason: context.reason ?? 'updated via /api/configuracoes/clinica PUT',
        ip: context.ip ?? null,
        user_agent: context.userAgent ?? null,
        result: 'success',
      })
      if (error) {
        // Não vamos quebrar a request — o update já foi commitado e a
        // ausência de audit é detectável depois pelo dashboard.
        // Mas log loud para investigação.
        console.error('updateClinicProfile audit insert failed', { field, error })
      }
    }),
  )

  return getClinicProfile(supabase, tenantId)
}

function readLogicalKey(profile: ClinicProfile, key: string): string | null {
  switch (key) {
    case 'corporateName':
      return profile.corporateName
    case 'cnpj':
      return profile.cnpj
    case 'phone':
      return profile.phone
    case 'email':
      return profile.email
    case 'address.cep':
      return profile.address.cep
    case 'address.street':
      return profile.address.street
    case 'address.number':
      return profile.address.number
    case 'address.complement':
      return profile.address.complement
    case 'address.neighborhood':
      return profile.address.neighborhood
    case 'address.city':
      return profile.address.city
    case 'address.uf':
      return profile.address.uf
    case 'techResponsible.name':
      return profile.techResponsible.name
    case 'techResponsible.council':
      return profile.techResponsible.council
    case 'techResponsible.registration':
      return profile.techResponsible.registration
    default:
      return null
  }
}

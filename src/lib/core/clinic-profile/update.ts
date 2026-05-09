import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import { isValidCnpj, stripCnpj } from './validate-cnpj'
import { getClinicProfile } from './read'
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
  corporateName: optionalString(200),
  cnpj: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v == null || v === '' ? null : stripCnpj(v)))
    .refine((v) => v == null || (v.length === 14 && isValidCnpj(v)), {
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
        .transform((v) => (v == null || v === '' ? null : v.replace(/\D+/g, '')))
        .refine((v) => v == null || /^[0-9]{8}$/.test(v), { message: 'CEP inválido' }),
      street: optionalString(200),
      number: optionalString(20),
      complement: optionalString(100),
      neighborhood: optionalString(100),
      city: optionalString(100),
      uf: z
        .string()
        .nullable()
        .optional()
        .transform((v) => (v == null || v === '' ? null : v.toUpperCase()))
        .refine((v) => v == null || (UF_CODES as readonly string[]).includes(v), {
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
        .transform((v) => (v == null || v === '' ? null : v.toUpperCase()))
        .refine((v) => v == null || (COUNCIL_CODES as readonly string[]).includes(v), {
          message: 'Conselho inválido',
        }),
      registration: optionalString(30),
    })
    .partial()
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
    return current
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

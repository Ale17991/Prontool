import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Lista pacientes do tenant com PII descriptografada via RPC bulk
 * (`list_patients_for_tenant`, migration 0027). Faz busca por substring
 * de nome ou CPF + paginação no lado do TS.
 *
 * Trade-off conhecido: como nome/CPF são columns BYTEA criptografadas
 * (LGPD), não dá pra usar `WHERE name ILIKE` direto no banco. Buscamos
 * tudo do tenant, descriptografamos e filtramos em memória. Para
 * tenants com >10k pacientes vai ficar lento — futuro: índice trigram
 * sobre uma versão hash searchable.
 */
export interface PatientListItem {
  id: string
  ghlContactId: string
  fullName: string
  cpf: string
  phone: string | null
  email: string | null
  birthDate: string | null
  address: {
    cep: string | null
    street: string | null
    number: string | null
    complement: string | null
    neighborhood: string | null
    city: string | null
    state: string | null
  }
  anonymizedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ListPatientsInput {
  tenantId: string
  search?: string // substring case-insensitive em nome OU cpf
  page?: number // 1-based
  pageSize?: number // default 25, max 100
}

export interface ListPatientsResult {
  items: PatientListItem[]
  total: number
  page: number
  pageSize: number
}

interface RpcRow {
  id: string
  ghl_contact_id: string
  full_name: string | null
  cpf: string | null
  phone: string | null
  email: string | null
  birth_date: string | null
  address_cep: string | null
  address_street: string | null
  address_number: string | null
  address_complement: string | null
  address_neighborhood: string | null
  address_city: string | null
  address_state: string | null
  anonymized_at: string | null
  created_at: string
  updated_at: string
}

export async function listPatients(
  supabase: SupabaseClient<Database>,
  input: ListPatientsInput,
): Promise<ListPatientsResult> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY required to decrypt patients')

  const { data, error } = await supabase.rpc('list_patients_for_tenant', {
    p_tenant_id: input.tenantId,
    p_key: key,
  })
  if (error) throw new Error(`list_patients_for_tenant failed: ${error.message}`)

  const all = ((data ?? []) as unknown as RpcRow[]).map(toItem)

  const term = (input.search ?? '').trim().toLowerCase()
  const filtered = term
    ? all.filter(
        (p) =>
          (p.fullName ?? '').toLowerCase().includes(term) ||
          (p.cpf ?? '').toLowerCase().includes(term),
      )
    : all

  const pageSize = Math.min(Math.max(input.pageSize ?? 25, 1), 100)
  const page = Math.max(input.page ?? 1, 1)
  const start = (page - 1) * pageSize
  const items = filtered.slice(start, start + pageSize)

  return { items, total: filtered.length, page, pageSize }
}

function toItem(r: RpcRow): PatientListItem {
  return {
    id: r.id,
    ghlContactId: r.ghl_contact_id,
    fullName: r.full_name ?? '',
    cpf: r.cpf ?? '',
    phone: r.phone,
    email: r.email,
    birthDate: r.birth_date,
    address: {
      cep: r.address_cep,
      street: r.address_street,
      number: r.address_number,
      complement: r.address_complement,
      neighborhood: r.address_neighborhood,
      city: r.address_city,
      state: r.address_state,
    },
    anonymizedAt: r.anonymized_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

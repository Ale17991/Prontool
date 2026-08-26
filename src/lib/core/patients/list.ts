import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Lista pacientes do tenant com PII descriptografada via RPC
 * (`list_patients_for_tenant`, reescrita na migration 0209).
 *
 * A busca e a paginação acontecem NO BANCO. Até a 0209 este arquivo pedia a
 * clínica inteira decifrada e filtrava em memória — o que custava ~1,4 s a
 * 1.000 pacientes e estourou o `statement_timeout` de 8 s quando uma clínica
 * chegou a 15 mil (215 mil decifragens numa consulta só). O comentário que
 * estava aqui previa isso; a importação da base do HiDoctor apenas chegou lá.
 *
 * Sem termo de busca, o custo não depende mais do tamanho da base: o banco
 * ordena por índice e decifra só as 25 linhas da página.
 *
 * COM termo, ainda há varredura — nome/CPF/telefone são bytea e não existe
 * índice sobre isso. O RPC decifra apenas a coluna que o termo exige. A
 * solução definitiva é índice cego por trigramas (HMAC numa tabela lateral com
 * GIN), que é feature própria e não conserto de produção parada.
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
  search?: string // substring case-insensitive em nome, CPF ou telefone
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
  /** Total de resultados ANTES da paginação; repetido em toda linha (0209). */
  total_count: number | string
}

export async function listPatients(
  supabase: SupabaseClient<Database>,
  input: ListPatientsInput,
): Promise<ListPatientsResult> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY required to decrypt patients')

  const pageSize = Math.min(Math.max(input.pageSize ?? 25, 1), 100)
  const page = Math.max(input.page ?? 1, 1)
  const search = (input.search ?? '').trim()

  // Nome, CPF e TELEFONE — a mesma regra de antes, agora executada em SQL.
  // Telefone entra porque é, junto do nome, o único dado que todo paciente tem:
  // clínica que não prescreve pela Memed pode ter base inteira sem CPF, e
  // buscar só por nome não desempata homônimo no balcão. A comparação por
  // dígitos continua valendo — quem digita "(11) 99999" acha quem foi gravado
  // como "11999990000".
  const { data, error } = await supabase.rpc('list_patients_for_tenant', {
    p_tenant_id: input.tenantId,
    p_key: key,
    // `undefined` some do JSON e o parâmetro cai no DEFAULT NULL do SQL.
    // Mandar `null` explícito é recusado pelo tipo gerado do RPC.
    p_search: search || undefined,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  })
  if (error) throw new Error(`list_patients_for_tenant failed: ${error.message}`)

  const rows = (data ?? []) as unknown as RpcRow[]
  const items = rows.map(toItem)

  // `total_count` vem repetido em cada linha. Página vazia não traz linha
  // nenhuma e portanto não traz total — aí o total é 0 mesmo, porque a única
  // forma de chegar aqui vazio é não haver resultado (a UI monta as páginas a
  // partir do total, então não oferece página fora da faixa).
  const total = rows[0]?.total_count ?? 0

  return { items, total: Number(total), page, pageSize }
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

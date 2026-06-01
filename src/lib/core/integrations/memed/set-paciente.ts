import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { getPatient } from '@/lib/core/patients/get'
import { MemedPatientFieldsMissingError } from './errors'
import { memedSetPacientePayloadSchema, type MemedSetPacientePayload } from './types'

/**
 * Monta o payload do comando `setPaciente` (Feature 026, US1) a partir do
 * paciente decifrado server-side. O frontend recebe esse payload pronto e o
 * repassa ao MdHub — nenhum dado é redigitado, e a decifragem nunca sai do
 * backend.
 *
 * Campos obrigatórios para prescrever (quickstart 026): nome, CPF, e-mail,
 * celular e data de nascimento. Faltando qualquer um → 422 listando.
 */

export interface BuildSetPacienteInput {
  supabase: SupabaseClient<Database>
  tenantId: string
  patientId: string
}

function mapSex(sex: string | null): 'M' | 'F' | undefined {
  if (sex === 'masculino') return 'M'
  if (sex === 'feminino') return 'F'
  return undefined
}

export async function buildSetPaciente(
  input: BuildSetPacienteInput,
): Promise<MemedSetPacientePayload> {
  const { patient } = await getPatient(input.supabase, {
    tenantId: input.tenantId,
    patientId: input.patientId,
  })

  const missing: string[] = []
  if (!patient.fullName.trim()) missing.push('nome')
  const cpf = (patient.cpf ?? '').replace(/\D/g, '')
  if (cpf.length !== 11) missing.push('CPF')
  if (!patient.email) missing.push('e-mail')
  if (!patient.phone) missing.push('celular')
  if (!patient.birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(patient.birthDate)) {
    missing.push('data de nascimento')
  }
  if (missing.length > 0) throw new MemedPatientFieldsMissingError(missing)

  const [year, month, day] = patient.birthDate!.split('-')
  const a = patient.address
  const hasAddress = Boolean(a.cep || a.street || a.city)

  return memedSetPacientePayloadSchema.parse({
    external_id: patient.id,
    nome: patient.fullName,
    cpf,
    sexo: mapSex(patient.sex),
    data_nascimento: `${day}/${month}/${year}`,
    telefone: patient.phone ?? undefined,
    email: patient.email ?? undefined,
    endereco: hasAddress
      ? {
          cep: a.cep ?? undefined,
          logradouro: a.street ?? undefined,
          numero: a.number ?? undefined,
          complemento: a.complement ?? undefined,
          bairro: a.neighborhood ?? undefined,
          cidade: a.city ?? undefined,
          estado: a.state ?? undefined,
        }
      : undefined,
  })
}

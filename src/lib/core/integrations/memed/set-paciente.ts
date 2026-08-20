import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { getPatient } from '@/lib/core/patients/get'
import { toBrazilianLocal } from '@/lib/core/whatsapp/phone'
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
    /**
     * Formato local (DDD + assinante), pelo mesmo motivo que o CPF sobe só com
     * dígitos: quem recebe é uma API brasileira, e ela espera o número como se
     * escreve aqui.
     *
     * Isto era `patient.phone` cru até 20/08/2026, e passou a estar errado sem
     * ninguém mexer neste arquivo: a `cf69453` fez o cadastro gravar o telefone
     * canônico do WhatsApp, então a Memed passou a receber `5511988887777` onde
     * antes chegava `(11) 98888-7777`. O teste do payload apontou, e ficou meses
     * lido como ruído da suíte.
     */
    telefone: patient.phone ? toBrazilianLocal(patient.phone) : undefined,
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

/**
 * Traduz o paciente para as linhas que saem no bloco de identificação.
 *
 * Um leitor por chave do catálogo (`fields.ts`), num lugar só. Antes disso cada
 * PDF montava a sua identificação à mão, e o resultado era o previsível: os
 * impressos da nutrição mostravam quatro campos, outros quatro documentos
 * mostravam só o nome — e não por decisão de ninguém, mas porque a rota
 * entregava `patientName: string` e mais nada.
 *
 * O PDF não conhece `PatientDetail`: recebe daqui rótulo e texto já prontos.
 * Assim o dado cifrado (`_enc`) continua sendo decifrado num caminho auditado
 * — o guard — em vez de espalhar-se por treze componentes de renderização.
 */
import type { PatientDetail } from '@/lib/core/patients/get'
import { PRINTOUT_PATIENT_FIELDS, type PrintoutPatientField } from './fields'

export interface IdentityLine {
  key: PrintoutPatientField
  label: string
  /** `null` = configurado mas sem dado no cadastro; o PDF imprime travessão. */
  value: string | null
}

export interface PatientIdentity {
  /** Sempre presente: o nome não é configurável (0195). */
  name: string
  lines: IdentityLine[]
}

const SEX_LABEL: Record<string, string> = {
  feminino: 'Feminino',
  masculino: 'Masculino',
  intersexo: 'Intersexo',
}

/**
 * Idade em anos completos na data de emissão.
 *
 * Recebe o DIA CIVIL da clínica ("AAAA-MM-DD"), não um instante: comparar
 * componentes de data elimina o erro de fuso em vez de administrá-lo. Emitir às
 * 22h em São Paulo já é o dia seguinte em UTC, e um `Date` faria o paciente
 * envelhecer um ano na véspera do aniversário. Mesmo critério do `ageAt` da 054.
 *
 * Calculada a cada emissão e não guardada em lugar nenhum: idade envelhece, e
 * um número gravado no dia da consulta estaria errado na reimpressão de depois.
 */
export function ageInYears(birthDate: string | null, issuedOn: string): number | null {
  if (!birthDate) return null
  const [by, bm, bd] = birthDate.slice(0, 10).split('-').map(Number)
  const [ay, am, ad] = issuedOn.slice(0, 10).split('-').map(Number)
  if (!by || !bm || !bd || !ay || !am || !ad) return null
  let age = ay - by
  if (am < bm || (am === bm && ad < bd)) age -= 1
  return age >= 0 && age < 150 ? age : null
}

function brDate(iso: string | null): string | null {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split('-')
  return y && m && d ? `${d}/${m}/${y}` : null
}

function digitsOnly(v: string | null): string | null {
  const d = (v ?? '').replace(/\D/g, '')
  return d.length > 0 ? d : null
}

function formatCpf(raw: string | null): string | null {
  const d = digitsOnly(raw)
  if (!d || d.length !== 11) return d
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

function formatPhone(raw: string | null): string | null {
  const d = digitsOnly(raw)
  if (!d) return null
  const local = d.startsWith('55') && d.length > 11 ? d.slice(2) : d
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  return d
}

function formatAddress(a: PatientDetail['address']): string | null {
  // Rua e cidade sozinhas já orientam; exigir o endereço inteiro faria um
  // cadastro parcial imprimir travessão como se não houvesse nada.
  const line1 = [a.street, a.number].filter(Boolean).join(', ')
  const line2 = [a.neighborhood, [a.city, a.state].filter(Boolean).join('/')]
    .filter(Boolean)
    .join(' - ')
  const cep = a.cep ? `CEP ${a.cep}` : null
  const parts = [line1 || null, a.complement, line2 || null, cep].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}

const READERS: Record<PrintoutPatientField, (p: PatientDetail, issuedOn: string) => string | null> =
  {
    nome_social: (p) => p.socialName,
    nascimento: (p) => brDate(p.birthDate),
    idade: (p, on) => {
      const age = ageInYears(p.birthDate, on)
      return age === null ? null : `${age} anos`
    },
    sexo: (p) => (p.sex ? (SEX_LABEL[p.sex] ?? p.sex) : null),
    cpf: (p) => formatCpf(p.cpf),
    rg: (p) => p.rg,
    telefone: (p) => formatPhone(p.phone),
    email: (p) => p.email,
    convenio: (p) => p.healthPlan?.name ?? null,
    carteirinha: (p) => p.insuranceCardNumber,
    endereco: (p) => formatAddress(p.address),
    nome_mae: (p) => p.motherName,
    responsavel: (p) =>
      p.guardianName
        ? p.guardianRelationship
          ? `${p.guardianName} (${p.guardianRelationship})`
          : p.guardianName
        : null,
  }

/**
 * Monta a identificação para os campos escolhidos.
 *
 * Campo escolhido e sem dado vira linha com `value: null`, e o PDF imprime
 * travessão — não some. É a mesma regra que a 054 aplicou às perguntas de
 * anamnese: omitir produz um papel que parece completo escondendo o que não foi
 * coletado. Quem não quer a linha desliga o campo; quem ligou está afirmando
 * que aquele dado importa naquele documento.
 */
export function buildPatientIdentity(
  patient: PatientDetail,
  fields: readonly PrintoutPatientField[],
  /** Dia civil da clínica, "AAAA-MM-DD". */
  issuedOn: string,
): PatientIdentity {
  const specByKey = new Map(PRINTOUT_PATIENT_FIELDS.map((f) => [f.key, f]))
  return {
    name: patient.fullName,
    lines: fields.map((key) => ({
      key,
      label: specByKey.get(key)?.label ?? key,
      value: READERS[key](patient, issuedOn),
    })),
  }
}

'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { IdCard, Loader2, Pencil, Save, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { PatientDetail } from '@/lib/core/patients/get'

const SEX_LABEL: Record<string, string> = {
  feminino: 'Feminino',
  masculino: 'Masculino',
  intersexo: 'Intersexo',
}

type IdentityFields = Pick<
  PatientDetail,
  | 'sex'
  | 'phone'
  | 'email'
  | 'socialName'
  | 'motherName'
  | 'rg'
  | 'insuranceCardNumber'
  | 'emergencyContactName'
  | 'emergencyContactPhone'
  | 'guardianName'
  | 'guardianCpf'
  | 'guardianRelationship'
>

export function IdentityEditor({
  patientId,
  identity,
  canEdit,
}: {
  patientId: string
  identity: IdentityFields
  canEdit: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [sex, setSex] = useState(identity.sex ?? '')
  const [phone, setPhone] = useState(identity.phone ?? '')
  const [email, setEmail] = useState(identity.email ?? '')
  const [socialName, setSocialName] = useState(identity.socialName ?? '')
  const [motherName, setMotherName] = useState(identity.motherName ?? '')
  const [rg, setRg] = useState(identity.rg ?? '')
  const [insuranceCardNumber, setInsuranceCardNumber] = useState(
    identity.insuranceCardNumber ?? '',
  )
  const [emergencyContactName, setEmergencyContactName] = useState(
    identity.emergencyContactName ?? '',
  )
  const [emergencyContactPhone, setEmergencyContactPhone] = useState(
    identity.emergencyContactPhone ?? '',
  )
  const [guardianName, setGuardianName] = useState(identity.guardianName ?? '')
  const [guardianCpf, setGuardianCpf] = useState(identity.guardianCpf ?? '')
  const [guardianRelationship, setGuardianRelationship] = useState(
    identity.guardianRelationship ?? '',
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setSex(identity.sex ?? '')
    setPhone(identity.phone ?? '')
    setEmail(identity.email ?? '')
    setSocialName(identity.socialName ?? '')
    setMotherName(identity.motherName ?? '')
    setRg(identity.rg ?? '')
    setInsuranceCardNumber(identity.insuranceCardNumber ?? '')
    setEmergencyContactName(identity.emergencyContactName ?? '')
    setEmergencyContactPhone(identity.emergencyContactPhone ?? '')
    setGuardianName(identity.guardianName ?? '')
    setGuardianCpf(identity.guardianCpf ?? '')
    setGuardianRelationship(identity.guardianRelationship ?? '')
    setError(null)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          identity: {
            sex: sex || null,
            phone: phone.trim() || null,
            email: email.trim() || null,
            social_name: socialName.trim() || null,
            mother_name: motherName.trim() || null,
            rg: rg.trim() || null,
            insurance_card_number: insuranceCardNumber.trim() || null,
            emergency_contact_name: emergencyContactName.trim() || null,
            emergency_contact_phone: emergencyContactPhone.trim() || null,
            guardian_name: guardianName.trim() || null,
            guardian_cpf: guardianCpf.replace(/\D/g, '') || null,
            guardian_relationship: guardianRelationship.trim() || null,
          },
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao salvar dados.')
        return
      }
      setEditing(false)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  if (!editing) {
    const rows: Array<[string, string | null]> = [
      ['Celular', identity.phone],
      ['E-mail', identity.email],
      ['Sexo', identity.sex ? (SEX_LABEL[identity.sex] ?? identity.sex) : null],
      ['Nome social', identity.socialName],
      ['Nome da mãe', identity.motherName],
      ['RG', identity.rg],
      ['Carteirinha do convênio', identity.insuranceCardNumber],
      [
        'Contato de emergência',
        [identity.emergencyContactName, identity.emergencyContactPhone]
          .filter(Boolean)
          .join(' · ') || null,
      ],
      [
        'Responsável legal',
        [
          identity.guardianName,
          identity.guardianRelationship ? `(${identity.guardianRelationship})` : null,
          identity.guardianCpf,
        ]
          .filter(Boolean)
          .join(' ') || null,
      ],
    ]
    const filled = rows.filter(([, v]) => v && v.length > 0)
    return (
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <IdCard className="h-3 w-3" /> Identificação e contatos
          </p>
          {canEdit ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
              className="h-7 gap-1 px-2 text-[11px]"
            >
              <Pencil className="h-3 w-3" />
              {filled.length > 0 ? 'Editar' : 'Adicionar'}
            </Button>
          ) : null}
        </div>
        {filled.length > 0 ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {filled.map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {label}
                </dt>
                <dd className="text-slate-700">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-xs italic text-slate-400">
            Sexo, nome social, nome da mãe, RG, carteirinha, contato de emergência e
            responsável ainda não informados.
          </p>
        )}
      </div>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          <IdCard className="h-3 w-3" /> Editar identificação e contatos
        </p>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={() => {
            reset()
            setEditing(false)
          }}
          className="h-7 gap-1 px-2 text-[11px]"
        >
          <X className="h-3 w-3" />
          Cancelar
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="id_phone">Celular</Label>
          <Input
            id="id_phone"
            inputMode="tel"
            placeholder="(11) 99999-9999"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="id_email">E-mail</Label>
          <Input
            id="id_email"
            type="email"
            inputMode="email"
            placeholder="paciente@exemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="id_sex">Sexo</Label>
          <Select value={sex} onValueChange={setSex}>
            <SelectTrigger id="id_sex">
              <SelectValue placeholder="Selecione…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="feminino">Feminino</SelectItem>
              <SelectItem value="masculino">Masculino</SelectItem>
              <SelectItem value="intersexo">Intersexo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="id_social">Nome social</Label>
          <Input
            id="id_social"
            value={socialName}
            onChange={(e) => setSocialName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="id_mother">Nome da mãe</Label>
          <Input
            id="id_mother"
            value={motherName}
            onChange={(e) => setMotherName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="id_rg">RG</Label>
          <Input id="id_rg" value={rg} onChange={(e) => setRg(e.target.value)} />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="id_card">Carteirinha do convênio</Label>
          <Input
            id="id_card"
            placeholder="Número da carteira / matrícula"
            value={insuranceCardNumber}
            onChange={(e) => setInsuranceCardNumber(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="id_emg_name">Contato de emergência — nome</Label>
          <Input
            id="id_emg_name"
            value={emergencyContactName}
            onChange={(e) => setEmergencyContactName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="id_emg_phone">Contato de emergência — telefone</Label>
          <Input
            id="id_emg_phone"
            inputMode="tel"
            placeholder="(11) 99999-9999"
            value={emergencyContactPhone}
            onChange={(e) => setEmergencyContactPhone(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="id_guardian_name">Responsável legal — nome</Label>
          <Input
            id="id_guardian_name"
            value={guardianName}
            onChange={(e) => setGuardianName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="id_guardian_cpf">Responsável legal — CPF</Label>
          <Input
            id="id_guardian_cpf"
            inputMode="numeric"
            placeholder="000.000.000-00"
            value={guardianCpf}
            onChange={(e) => setGuardianCpf(e.target.value)}
          />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="id_guardian_rel">Responsável legal — parentesco</Label>
          <Input
            id="id_guardian_rel"
            placeholder="Mãe, pai, tutor…"
            value={guardianRelationship}
            onChange={(e) => setGuardianRelationship(e.target.value)}
          />
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending} className="gap-2">
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Salvar
        </Button>
      </div>
    </form>
  )
}

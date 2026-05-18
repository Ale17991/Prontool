'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  PatientTypeahead,
  type PatientTypeaheadValue,
} from '@/components/patients/patient-typeahead'

export type FieldType =
  | 'texto_curto'
  | 'texto_longo'
  | 'checkbox'
  | 'radio'
  | 'select'
  | 'data'
  | 'numero'

export interface TemplateField {
  id: string
  type: FieldType
  label: string
  required: boolean
  options?: string[]
  is_default?: boolean
}

export interface PatientOption {
  id: string
  fullName: string
  cpf: string
  phone?: string | null
  email?: string | null
  birthDate?: string | null
  healthPlanName?: string | null
  address?: {
    cep: string | null
    street: string | null
    number: string | null
    complement: string | null
    neighborhood: string | null
    city: string | null
    state: string | null
  }
}

interface ApplyTemplateFormProps {
  templateId: string
  fields: TemplateField[]
}

type ResponseValue = string | number | string[] | null

/**
 * Mapeia o id do campo padrão pra um valor extraído do paciente.
 * Usado tanto pelo apply standalone quanto pela versão inline na ficha
 * clínica do paciente — qualquer mudança aqui propaga pra ambos.
 */
export function prefillResponsesFromPatient(
  fields: { id: string; is_default?: boolean }[],
  p: PatientOption | null,
): Record<string, ResponseValue> {
  if (!p) return {}
  const formatAddress = (a: PatientOption['address']): string | null => {
    if (!a) return null
    const line1 = [a.street, a.number].filter(Boolean).join(', ')
    const compl = a.complement ? ` — ${a.complement}` : ''
    const line2 = [a.neighborhood, a.city, a.state].filter(Boolean).join(' · ')
    const full = [line1 + compl, line2].filter(Boolean).join('\n')
    return full || null
  }
  const formatCep = (raw: string | null | undefined): string | null => {
    if (!raw) return null
    const d = raw.replace(/\D/g, '')
    return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : raw
  }
  const map: Record<string, ResponseValue> = {
    default_nome: p.fullName ?? null,
    default_cpf: p.cpf ?? null,
    default_telefone: p.phone ?? null,
    default_email: p.email ?? null,
    default_data_nasc: p.birthDate ?? null,
    default_plano: p.healthPlanName ?? null,
    default_cep: formatCep(p.address?.cep),
    default_endereco: formatAddress(p.address),
  }
  const out: Record<string, ResponseValue> = {}
  for (const f of fields) {
    if (!f.is_default) continue
    const v = map[f.id]
    if (v !== undefined && v !== null && v !== '') out[f.id] = v
  }
  return out
}

export function ApplyTemplateForm({ templateId, fields }: ApplyTemplateFormProps) {
  const router = useRouter()
  const [patientId, setPatientId] = useState<string>('')
  const [responses, setResponses] = useState<Record<string, ResponseValue>>({})
  const [submitting, setSubmitting] = useState(false)
  const [loadingPrefill, setLoadingPrefill] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePatientChange(p: PatientTypeaheadValue | null) {
    setPatientId(p?.id ?? '')
    if (!p) {
      setResponses({})
      return
    }
    // O typeahead entrega só dados básicos (id, nome, CPF, plano).
    // Para prefill precisamos do detalhe completo (endereço, contato,
    // data de nascimento) — buscamos via /api/pacientes/{id}.
    setLoadingPrefill(true)
    try {
      const res = await fetch(`/api/pacientes/${p.id}`)
      if (!res.ok) {
        // Sem detalhe: prefilla com o pouco que o typeahead trouxe.
        setResponses(
          prefillResponsesFromPatient(fields, {
            id: p.id,
            fullName: p.fullName,
            cpf: p.cpf,
            healthPlanName: p.planName,
          }),
        )
        return
      }
      const body = (await res.json()) as {
        patient: {
          id: string
          fullName: string
          cpf: string
          phone: string | null
          email: string | null
          birthDate: string | null
          address: PatientOption['address']
          healthPlan: { id: string; name: string } | null
        }
      }
      const detail: PatientOption = {
        id: body.patient.id,
        fullName: body.patient.fullName,
        cpf: body.patient.cpf,
        phone: body.patient.phone,
        email: body.patient.email,
        birthDate: body.patient.birthDate,
        healthPlanName: body.patient.healthPlan?.name ?? null,
        address: body.patient.address,
      }
      setResponses(prefillResponsesFromPatient(fields, detail))
    } catch {
      // Best-effort prefill com dados do typeahead.
      setResponses(
        prefillResponsesFromPatient(fields, {
          id: p.id,
          fullName: p.fullName,
          cpf: p.cpf,
          healthPlanName: p.planName,
        }),
      )
    } finally {
      setLoadingPrefill(false)
    }
  }

  function setValue(fieldId: string, value: ResponseValue) {
    setResponses((prev) => ({ ...prev, [fieldId]: value }))
  }

  function toggleCheckbox(fieldId: string, option: string, checked: boolean) {
    const current = (responses[fieldId] as string[] | undefined) ?? []
    const next = checked ? [...current, option] : current.filter((o) => o !== option)
    setValue(fieldId, next)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!patientId) {
      setError('Selecione um paciente.')
      return
    }
    for (const f of fields) {
      if (!f.required) continue
      const v = responses[f.id]
      const empty =
        v === undefined ||
        v === null ||
        v === '' ||
        (Array.isArray(v) && v.length === 0)
      if (empty) {
        setError(`Preencha o campo obrigatório: ${f.label}`)
        return
      }
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/anamnesis-templates/${templateId}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, responses }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao aplicar o modelo.')
        return
      }
      router.push(`/operacao/pacientes/${patientId}`)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
          Paciente
        </label>
        <PatientTypeahead
          value={patientId || null}
          onChange={handlePatientChange}
          disabled={submitting}
        />
        {patientId ? (
          <p className="text-[10px] text-slate-500">
            {loadingPrefill
              ? 'Carregando dados do paciente para pré-preencher campos padrão…'
              : 'Campos padrão pré-preenchidos a partir do cadastro deste paciente — você pode editar antes de salvar.'}
          </p>
        ) : null}
      </div>

      <div className="space-y-5 border-t border-slate-100 pt-5">
        {fields.map((field) => (
          <FieldInput
            key={field.id}
            field={field}
            value={responses[field.id]}
            onChange={(v) => setValue(field.id, v)}
            onToggleOption={(opt, checked) => toggleCheckbox(field.id, opt, checked)}
            isDefault={field.is_default ?? false}
          />
        ))}
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting} className="gap-2">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar anamnese
        </Button>
      </div>
    </form>
  )
}

function FieldInput({
  field,
  value,
  onChange,
  onToggleOption,
  isDefault,
}: {
  field: TemplateField
  value: ResponseValue | undefined
  onChange: (v: ResponseValue) => void
  onToggleOption: (option: string, checked: boolean) => void
  isDefault?: boolean
}) {
  const label = (
    <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
      <span>
        {field.label}
        {field.required ? <span className="ml-1 text-rose-500">*</span> : null}
      </span>
      {isDefault ? (
        <Badge
          variant="secondary"
          className="h-4 bg-blue-100 px-1.5 text-[9px] text-blue-800"
        >
          Padrão
        </Badge>
      ) : null}
    </label>
  )

  if (field.type === 'texto_longo') {
    return (
      <div className="space-y-1.5">
        {label}
        <Textarea
          value={(value as string | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[96px]"
        />
      </div>
    )
  }

  if (field.type === 'data') {
    return (
      <div className="space-y-1.5">
        {label}
        <Input
          type="date"
          value={(value as string | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    )
  }

  if (field.type === 'numero') {
    return (
      <div className="space-y-1.5">
        {label}
        <Input
          type="number"
          value={(value as string | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    )
  }

  if (field.type === 'select') {
    const opts = field.options ?? []
    return (
      <div className="space-y-1.5">
        {label}
        <Select
          value={(value as string | undefined) ?? ''}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione…" />
          </SelectTrigger>
          <SelectContent>
            {opts.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  if (field.type === 'radio') {
    const opts = field.options ?? []
    return (
      <div className="space-y-2">
        {label}
        <div className="flex flex-col gap-2">
          {opts.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name={field.id}
                value={opt}
                checked={value === opt}
                onChange={() => onChange(opt)}
                className="h-4 w-4"
              />
              {opt}
            </label>
          ))}
        </div>
      </div>
    )
  }

  if (field.type === 'checkbox') {
    const opts = field.options ?? []
    const checked = (value as string[] | undefined) ?? []
    return (
      <div className="space-y-2">
        {label}
        <div className="flex flex-col gap-2">
          {opts.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={checked.includes(opt)}
                onChange={(e) => onToggleOption(opt, e.target.checked)}
                className="h-4 w-4"
              />
              {opt}
            </label>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {label}
      <Input
        value={(value as string | undefined) ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

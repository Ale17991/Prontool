'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
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
}

interface PatientOption {
  id: string
  fullName: string
  cpf: string
}

interface ApplyTemplateFormProps {
  templateId: string
  fields: TemplateField[]
  patients: PatientOption[]
}

type ResponseValue = string | number | string[] | null

export function ApplyTemplateForm({ templateId, fields, patients }: ApplyTemplateFormProps) {
  const router = useRouter()
  const [patientId, setPatientId] = useState<string>('')
  const [responses, setResponses] = useState<Record<string, ResponseValue>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        <Select value={patientId} onValueChange={setPatientId}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione um paciente…" />
          </SelectTrigger>
          <SelectContent>
            {patients.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.fullName}
                {p.cpf ? ` — ${p.cpf}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-5 border-t border-slate-100 pt-5">
        {fields.map((field) => (
          <FieldInput
            key={field.id}
            field={field}
            value={responses[field.id]}
            onChange={(v) => setValue(field.id, v)}
            onToggleOption={(opt, checked) => toggleCheckbox(field.id, opt, checked)}
          />
        ))}
      </div>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
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
}: {
  field: TemplateField
  value: ResponseValue | undefined
  onChange: (v: ResponseValue) => void
  onToggleOption: (option: string, checked: boolean) => void
}) {
  const label = (
    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
      {field.label}
      {field.required ? <span className="ml-1 text-rose-500">*</span> : null}
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

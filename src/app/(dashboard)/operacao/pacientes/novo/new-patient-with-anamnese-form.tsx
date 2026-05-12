'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type {
  AnamnesisField,
  AnamnesisTemplateOption,
  HealthPlanOption,
} from './new-patient-page-client'

type ResponseValue = string | number | string[] | null

interface Props {
  template: AnamnesisTemplateOption
  healthPlans: HealthPlanOption[]
}

export function NewPatientWithAnamneseForm({ template, healthPlans }: Props) {
  const router = useRouter()
  const [responses, setResponses] = useState<Record<string, ResponseValue>>({})
  const [planId, setPlanId] = useState<string>('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState<{
    patientId: string
    fullName: string
  } | null>(null)

  const defaults = template.fields.filter((f) => f.is_default)
  const customs = template.fields.filter((f) => !f.is_default)

  function setValue(fieldId: string, value: ResponseValue) {
    setResponses((prev) => ({ ...prev, [fieldId]: value }))
  }

  function toggleCheckbox(fieldId: string, option: string, checked: boolean) {
    const current = (responses[fieldId] as string[] | undefined) ?? []
    const next = checked ? [...current, option] : current.filter((o) => o !== option)
    setValue(fieldId, next)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setDuplicate(null)

    // Validação cliente: só obrigatórios. CPF opcional em fase de testes,
    // independente do flag do template — override explicito.
    for (const f of template.fields) {
      if (!f.required) continue
      if (f.id === 'default_cpf') continue
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

    // CPF opcional em fase de testes; se preenchido, exige 11 digitos.
    const rawCpf = (responses['default_cpf'] as string | undefined) ?? ''
    const cpfDigits = rawCpf.replace(/\D/g, '')
    if (cpfDigits.length > 0 && cpfDigits.length !== 11) {
      setError('CPF deve ter 11 dígitos quando preenchido (ou deixe em branco).')
      return
    }
    if (!planId) {
      setError('Selecione um plano de saúde ou "Sem plano (particular)".')
      return
    }

    // Normaliza default_plano com o nome do plano selecionado pra que o
    // snapshot da anamnese fique consistente com o plan_id do paciente.
    const normalizedResponses = { ...responses }
    const planName =
      planId === '__none__'
        ? 'Sem plano (particular)'
        : healthPlans.find((p) => p.id === planId)?.name ?? null
    if (planName && template.fields.some((f) => f.id === 'default_plano')) {
      normalizedResponses['default_plano'] = planName
    }

    setPending(true)
    try {
      const res = await fetch('/api/pacientes/com-anamnese', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          template_id: template.id,
          responses: normalizedResponses,
          patient_plan_id: planId === '__none__' ? null : planId,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        patient_id?: string
        error?: {
          code?: string
          message?: string
          meta?: { patient_id?: string; full_name?: string }
        }
      }
      if (res.status === 409 && body.error?.code === 'PATIENT_CPF_DUPLICATE') {
        setDuplicate({
          patientId: body.error.meta?.patient_id ?? '',
          fullName: body.error.meta?.full_name ?? '(paciente)',
        })
        return
      }
      if (!res.ok || !body.patient_id) {
        setError(body.error?.message ?? 'Falha ao criar paciente.')
        return
      }
      router.push(`/operacao/pacientes/${body.patient_id}`)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <section className="space-y-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          Dados do paciente
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {defaults.map((f) => (
            <DefaultFieldInput
              key={f.id}
              field={f}
              value={responses[f.id]}
              onChange={(v) => setValue(f.id, v)}
              onToggleOption={(opt, checked) => toggleCheckbox(f.id, opt, checked)}
              healthPlans={healthPlans}
              planId={planId}
              onPlanChange={setPlanId}
            />
          ))}
          {/* Se o template não tem default_plano, ainda exigimos plan select */}
          {!defaults.some((f) => f.id === 'default_plano') ? (
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="plan_id">
                Plano de saúde <span className="text-rose-500">*</span>
              </Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger id="plan_id">
                  <SelectValue placeholder="Selecione um plano…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sem plano (particular)</SelectItem>
                  {healthPlans.map((hp) => (
                    <SelectItem key={hp.id} value={hp.id}>
                      {hp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {healthPlans.length === 0 ? (
                <p className="text-[11px] text-slate-500">
                  Nenhum plano ativo cadastrado.{' '}
                  <Link href="/configuracoes/convenios" className="underline">
                    Cadastrar plano
                  </Link>
                  .
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {customs.length > 0 ? (
        <section className="space-y-4 border-t border-slate-200 pt-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Anamnese — {template.title}
          </p>
          <div className="space-y-4">
            {customs.map((f) => (
              <CustomFieldInput
                key={f.id}
                field={f}
                value={responses[f.id]}
                onChange={(v) => setValue(f.id, v)}
                onToggleOption={(opt, checked) => toggleCheckbox(f.id, opt, checked)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {duplicate ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
          <p className="font-bold text-amber-800">CPF já cadastrado.</p>
          <p className="mt-1 text-amber-700">
            <Link
              href={`/operacao/pacientes/${duplicate.patientId}`}
              className="font-semibold text-primary underline"
            >
              Abrir ficha de {duplicate.fullName}
            </Link>{' '}
            ou edite o CPF acima e tente novamente.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending} className="gap-2">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar paciente + anamnese
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Field renderers — separadas pra ficar claro o caminho default vs custom
// ---------------------------------------------------------------------------

function DefaultFieldInput({
  field,
  value,
  onChange,
  onToggleOption,
  healthPlans,
  planId,
  onPlanChange,
}: {
  field: AnamnesisField
  value: ResponseValue | undefined
  onChange: (v: ResponseValue) => void
  onToggleOption: (option: string, checked: boolean) => void
  healthPlans: HealthPlanOption[]
  planId: string
  onPlanChange: (v: string) => void
}) {
  const fullWidth =
    field.id === 'default_nome' ||
    field.id === 'default_endereco' ||
    field.id === 'default_plano'
  const colSpan = fullWidth ? 'md:col-span-2' : ''

  // Override visual pra default_plano: render Select com planos + sem-plano.
  if (field.id === 'default_plano') {
    return (
      <div className={`space-y-1.5 ${colSpan}`}>
        <FieldLabel field={field} forceRequired />
        <Select value={planId} onValueChange={onPlanChange}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione um plano…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Sem plano (particular)</SelectItem>
            {healthPlans.map((hp) => (
              <SelectItem key={hp.id} value={hp.id}>
                {hp.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {healthPlans.length === 0 ? (
          <p className="text-[11px] text-slate-500">
            Nenhum plano ativo cadastrado.{' '}
            <Link href="/configuracoes/convenios" className="underline">
              Cadastrar plano
            </Link>
            .
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className={`space-y-1.5 ${colSpan}`}>
      <FieldLabel field={field} />
      <FieldBody
        field={field}
        value={value}
        onChange={onChange}
        onToggleOption={onToggleOption}
      />
    </div>
  )
}

function CustomFieldInput({
  field,
  value,
  onChange,
  onToggleOption,
}: {
  field: AnamnesisField
  value: ResponseValue | undefined
  onChange: (v: ResponseValue) => void
  onToggleOption: (option: string, checked: boolean) => void
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel field={field} />
      <FieldBody
        field={field}
        value={value}
        onChange={onChange}
        onToggleOption={onToggleOption}
      />
    </div>
  )
}

function FieldLabel({
  field,
  forceRequired,
}: {
  field: AnamnesisField
  forceRequired?: boolean
}) {
  return (
    <Label className="flex items-center gap-2 text-xs">
      <span>
        {field.label}
        {field.required || forceRequired ? (
          <span className="ml-1 text-rose-500">*</span>
        ) : null}
      </span>
      {field.is_default ? (
        <Badge
          variant="secondary"
          className="h-4 bg-blue-100 px-1.5 text-[9px] text-blue-800"
        >
          Padrão
        </Badge>
      ) : null}
    </Label>
  )
}

function FieldBody({
  field,
  value,
  onChange,
  onToggleOption,
}: {
  field: AnamnesisField
  value: ResponseValue | undefined
  onChange: (v: ResponseValue) => void
  onToggleOption: (option: string, checked: boolean) => void
}) {
  const type = field.type

  if (type === 'texto_longo') {
    return (
      <Textarea
        value={(value as string | undefined) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[80px]"
      />
    )
  }
  if (type === 'data') {
    return (
      <Input
        type="date"
        value={(value as string | undefined) ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  if (type === 'numero') {
    return (
      <Input
        type="number"
        value={(value as string | undefined) ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  if (type === 'select') {
    const opts = field.options ?? []
    return (
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
    )
  }
  if (type === 'radio') {
    const opts = field.options ?? []
    return (
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
    )
  }
  if (type === 'checkbox') {
    const opts = field.options ?? []
    const checked = (value as string[] | undefined) ?? []
    return (
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
    )
  }
  // texto_curto e fallback
  const placeholder =
    field.id === 'default_cpf'
      ? '000.000.000-00'
      : field.id === 'default_telefone'
        ? '(11) 99999-9999'
        : field.id === 'default_cep'
          ? '00000-000'
          : undefined
  return (
    <Input
      value={(value as string | undefined) ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={field.id === 'default_cpf' || field.id === 'default_telefone' ? 'numeric' : undefined}
    />
  )
}

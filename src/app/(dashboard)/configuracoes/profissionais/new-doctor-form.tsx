'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { UF_CODES } from '@/lib/core/clinic-profile/types'

const ROLE_OPTIONS = [
  'Médico',
  'Dentista',
  'Fisioterapeuta',
  'Psicólogo',
  'Nutricionista',
  'Fonoaudiólogo',
  'Terapeuta Ocupacional',
  'Enfermeiro',
  'Outro',
] as const

const COUNCIL_OPTIONS = [
  'CRM',
  'CRO',
  'CREFITO',
  'CFP',
  'CRN',
  'CRFa',
  'COREN',
  'Outro',
] as const

type PaymentMode = 'comissionado' | 'fixo' | 'liberal'

const PAYMENT_MODE_OPTIONS: Array<{ value: PaymentMode; label: string; hint: string }> = [
  {
    value: 'comissionado',
    label: 'Comissionado',
    hint: 'Recebe % sobre o valor dos atendimentos.',
  },
  {
    value: 'fixo',
    label: 'Fixo',
    hint: 'Recebe um valor mensal no dia configurado, independente do volume de atendimentos.',
  },
  {
    value: 'liberal',
    label: 'Liberal',
    hint:
      'Cobra por participação como assistente em atendimentos de outros profissionais.',
  },
]

export function NewDoctorForm() {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<(typeof ROLE_OPTIONS)[number]>('Médico')
  const [specialty, setSpecialty] = useState('')
  const [councilName, setCouncilName] = useState<(typeof COUNCIL_OPTIONS)[number]>('CRM')
  const [councilNumber, setCouncilNumber] = useState('')
  const [councilState, setCouncilState] = useState('')
  const [cpf, setCpf] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [externalId, setExternalId] = useState('')
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('comissionado')
  // Comissionado
  const [percentStr, setPercentStr] = useState('')
  // Fixo
  const [monthlyAmountStr, setMonthlyAmountStr] = useState('')
  const [billingDay, setBillingDay] = useState('1')
  // Liberal
  const [liberalDefaultStr, setLiberalDefaultStr] = useState('')

  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('Cadastro inicial')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    // Dados exigidos pela Memed — obrigatórios em todo cadastro.
    const cpfDigits = cpf.replace(/\D/g, '')
    if (cpfDigits.length !== 11) {
      setError('Informe um CPF válido (11 dígitos).')
      return
    }
    if (!councilState) {
      setError('Informe a UF do conselho.')
      return
    }
    if (!birthDate) {
      setError('Informe a data de nascimento.')
      return
    }

    const payload: Record<string, unknown> = {
      full_name: fullName.trim(),
      crm: councilNumber.trim(),
      council_number: councilNumber.trim(),
      council_name: councilName,
      council_state: councilState,
      cpf: cpfDigits,
      birth_date: birthDate,
      role,
      specialty: specialty.trim() || null,
      external_identifier: externalId.trim() || null,
      payment_mode: paymentMode,
      initial_valid_from: validFrom,
      initial_reason: reason.trim(),
    }

    if (paymentMode === 'comissionado') {
      const bps = toBps(percentStr)
      if (bps === null) {
        setError('Comissão deve ser um percentual válido (ex.: 40 ou 37,5).')
        return
      }
      payload.initial_percentage_bps = bps
    } else if (paymentMode === 'fixo') {
      const cents = toCents(monthlyAmountStr)
      if (cents === null || cents <= 0) {
        setError('Valor mensal deve ser maior que zero (ex.: 8000 ou 8000,50).')
        return
      }
      const day = Number(billingDay)
      if (!Number.isInteger(day) || day < 1 || day > 28) {
        setError('Dia de faturamento deve ser um inteiro entre 1 e 28.')
        return
      }
      payload.monthly_amount_cents = cents
      payload.billing_day = day
    } else if (paymentMode === 'liberal') {
      const cents = toCents(liberalDefaultStr)
      if (cents === null || cents <= 0) {
        setError('Valor padrão por participação deve ser maior que zero.')
        return
      }
      payload.liberal_default_cents = cents
    }

    setPending(true)
    try {
      const res = await fetch('/api/medicos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Nº de registro já cadastrado nesta clínica.')
        return
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        throw new Error(body.error?.message ?? `HTTP ${res.status}`)
      }
      const created = (await res.json()) as { full_name: string }
      setSuccess(`Profissional ${created.full_name} cadastrado.`)
      setFullName('')
      setCouncilNumber('')
      setCouncilState('')
      setCpf('')
      setBirthDate('')
      setSpecialty('')
      setExternalId('')
      setPercentStr('')
      setMonthlyAmountStr('')
      setLiberalDefaultStr('')
      setReason('Cadastro inicial')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  const modeMeta = PAYMENT_MODE_OPTIONS.find((o) => o.value === paymentMode)

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="full-name" className="text-xs">
          Nome completo
        </Label>
        <Input
          id="full-name"
          required
          minLength={1}
          maxLength={200}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Ex.: Ana Silva"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="role" className="text-xs">
            Função
          </Label>
          <select
            id="role"
            required
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="specialty" className="text-xs">
            Especialidade <span className="text-slate-400">(opcional)</span>
          </Label>
          <Input
            id="specialty"
            maxLength={120}
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
            placeholder="Ex.: Ortopedia, Endodontia"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="council-name" className="text-xs">
            Conselho
          </Label>
          <select
            id="council-name"
            required
            value={councilName}
            onChange={(e) => setCouncilName(e.target.value as typeof councilName)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {COUNCIL_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="council-state" className="text-xs">
            UF
          </Label>
          <select
            id="council-state"
            required
            value={councilState}
            onChange={(e) => setCouncilState(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">—</option>
            {UF_CODES.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5 col-span-2">
          <Label htmlFor="council-number" className="text-xs">
            Nº de Registro
          </Label>
          <Input
            id="council-number"
            required
            minLength={1}
            maxLength={50}
            value={councilNumber}
            onChange={(e) => setCouncilNumber(e.target.value)}
            placeholder="Ex.: 123456"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cpf" className="text-xs">
            CPF
          </Label>
          <Input
            id="cpf"
            required
            inputMode="numeric"
            maxLength={14}
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
            placeholder="000.000.000-00"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="birth-date" className="text-xs">
            Data de nascimento
          </Label>
          <Input
            id="birth-date"
            type="date"
            required
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
          />
        </div>
      </div>
      <p className="text-[11px] text-slate-500">
        CPF, UF do conselho e data de nascimento são necessários para emitir
        prescrição digital (Memed). Podem ser preenchidos depois.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="external-id" className="text-xs">
          Identificador externo <span className="text-slate-400">(opcional)</span>
        </Label>
        <Input
          id="external-id"
          maxLength={120}
          value={externalId}
          onChange={(e) => setExternalId(e.target.value)}
          placeholder="ID em sistema externo (CRM, prontuário, etc.)"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="payment-mode" className="text-xs">
          Modalidade de pagamento
        </Label>
        <select
          id="payment-mode"
          required
          value={paymentMode}
          onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {PAYMENT_MODE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {modeMeta ? (
          <p className="text-[11px] text-slate-500">{modeMeta.hint}</p>
        ) : null}
      </div>

      {paymentMode === 'comissionado' ? (
        <div className="space-y-1.5">
          <Label htmlFor="percent" className="text-xs">
            Comissão inicial (%)
          </Label>
          <Input
            id="percent"
            required
            inputMode="decimal"
            value={percentStr}
            onChange={(e) => setPercentStr(e.target.value)}
            placeholder="40"
          />
        </div>
      ) : null}

      {paymentMode === 'fixo' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="monthly-amount" className="text-xs">
              Valor mensal (R$)
            </Label>
            <Input
              id="monthly-amount"
              required
              inputMode="decimal"
              value={monthlyAmountStr}
              onChange={(e) => setMonthlyAmountStr(e.target.value)}
              placeholder="8000,00"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="billing-day" className="text-xs">
              Dia de faturamento (1–28)
            </Label>
            <Input
              id="billing-day"
              required
              type="number"
              min={1}
              max={28}
              value={billingDay}
              onChange={(e) => setBillingDay(e.target.value)}
            />
          </div>
        </div>
      ) : null}

      {paymentMode === 'liberal' ? (
        <div className="space-y-1.5">
          <Label htmlFor="liberal-default" className="text-xs">
            Valor padrão por participação (R$)
          </Label>
          <Input
            id="liberal-default"
            required
            inputMode="decimal"
            value={liberalDefaultStr}
            onChange={(e) => setLiberalDefaultStr(e.target.value)}
            placeholder="350,00"
          />
          <p className="text-[10px] text-slate-500">
            Valor pré-preenchido ao adicionar este profissional como assistente em
            atendimentos — pode ser editado caso a caso.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="valid-from" className="text-xs">
            Vigência a partir de
          </Label>
          <Input
            id="valid-from"
            required
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reason" className="text-xs">
            Motivo
          </Label>
          <Input
            id="reason"
            required
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Salvando…' : 'Cadastrar profissional'}
      </Button>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border border-success/30 bg-success-bg p-3 text-xs font-medium text-success-text">
          {success}
        </p>
      ) : null}
    </form>
  )
}

function toBps(input: string): number | null {
  const cleaned = input.trim().replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (Number.isNaN(value) || value < 0 || value > 100) return null
  return Math.round(value * 100)
}

/**
 * Aceita "8000", "8000,50", "8000.50", "R$ 8.000,50" → cents.
 * Retorna `null` para input inválido.
 */
function toCents(input: string): number | null {
  const cleaned = input.trim().replace(/R\$\s*/gi, '').replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (Number.isNaN(value) || value < 0) return null
  return Math.round(value * 100)
}

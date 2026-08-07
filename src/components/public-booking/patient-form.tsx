'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  describeMissingFields,
  missingRequiredPatientFields,
  patientFieldPolicy,
  type PatientField,
} from '@/lib/core/patients/required-fields'
import { TurnstileWidget } from './turnstile-widget'

interface PatientFormProps {
  slug: string
  doctorId: string
  doctorName: string
  procedureId: string
  procedureName: string
  slotStart: string
  clinicName: string
  /**
   * Clínica prescritora Memed: CPF, e-mail e nascimento passam a ser
   * obrigatórios já aqui. Fora disso, o paciente entrega só nome e telefone —
   * cada campo a mais na tela pública é agendamento que não acontece.
   */
  memedPrescriber: boolean
}

function maskCpf(v: string): string {
  return v.replace(/\D/g, '').slice(0, 11)
}

function maskPhone(v: string): string {
  return v.replace(/[^0-9+\s()-]/g, '').slice(0, 20)
}

function formatBrasilia(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function PatientForm({
  slug,
  doctorId,
  doctorName,
  procedureId,
  procedureName,
  slotStart,
  clinicName,
  memedPrescriber,
}: PatientFormProps) {
  const policy = patientFieldPolicy(memedPrescriber)
  const req = (f: PatientField) => policy.required.includes(f)
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [cpf, setCpf] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!consent) {
      setError('Você precisa aceitar a política de privacidade.')
      return
    }
    if (!turnstileToken) {
      setError('Aguarde a verificação anti-spam terminar e tente novamente.')
      return
    }
    const cleanedCpf = cpf.replace(/\D/g, '')
    const missing = missingRequiredPatientFields(
      {
        full_name: fullName,
        phone,
        cpf: cleanedCpf,
        email,
        birth_date: birthDate,
      },
      policy,
    )
    if (missing.length > 0) {
      setError(`Preencha ${describeMissingFields(missing)}.`)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const patient: Record<string, unknown> = {
        full_name: fullName.trim(),
        phone: phone.trim(),
      }
      // Campos opcionais só viajam quando preenchidos — mandar string vazia
      // reprovaria no formato do Zod em vez de simplesmente não existir.
      if (email.trim()) patient.email = email.trim()
      if (birthDate) patient.birth_date = birthDate
      if (cleanedCpf.length === 11) patient.cpf = cleanedCpf
      const payload: Record<string, unknown> = {
        doctor_id: doctorId,
        procedure_id: procedureId,
        slot_start: slotStart,
        patient,
        lgpd_consent: true,
        turnstile_token: turnstileToken,
      }
      const res = await fetch(`/api/public/booking/${slug}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        const errCode = (json.error as string) ?? 'UNKNOWN'
        if (errCode === 'SLOT_NO_LONGER_AVAILABLE') {
          setError('Esse horário acabou de ser ocupado. Escolha outro.')
          setTimeout(() => {
            router.push(
              `/agendar/${slug}/horarios?doctor_id=${doctorId}&procedure_id=${procedureId}`,
            )
          }, 2000)
        } else if (errCode === 'VALIDATION_FAILED') {
          setError((json.message as string) ?? 'Não foi possível validar os dados informados.')
        } else if (errCode === 'INVALID_PAYLOAD') {
          setError((json.message as string) ?? 'Verifique os campos preenchidos e tente novamente.')
        } else {
          setError(`Erro ao agendar (${errCode}). Tente novamente.`)
        }
        return
      }
      const redirectUrl = json.redirectUrl as string
      router.push(redirectUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro de rede.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Resumo */}
      <section className="rounded-lg border border-border bg-card p-4 text-sm">
        <div className="font-semibold text-slate-900">{clinicName}</div>
        <div className="mt-2 grid gap-1 text-slate-700">
          <div>
            <span className="text-slate-500">Profissional:</span> {doctorName}
          </div>
          <div>
            <span className="text-slate-500">Procedimento:</span> {procedureName}
          </div>
          <div>
            <span className="text-slate-500">Data e hora:</span> {formatBrasilia(slotStart)}
          </div>
        </div>
      </section>

      {/* Form */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-1 text-base font-semibold text-slate-900">Seus dados</h2>
        {memedPrescriber ? (
          <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-800">
            Esta clínica emite receita digital — por isso pedimos CPF, e-mail e data de
            nascimento. São os dados que o receituário exige.
          </p>
        ) : (
          <p className="mb-3 text-xs text-slate-500">
            Só precisamos do essencial para reservar seu horário.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="full_name" className="block text-sm font-medium text-slate-700">
              Nome completo *
            </label>
            <input
              id="full_name"
              type="text"
              required
              minLength={3}
              maxLength={120}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">
              Email {req('email') ? '*' : '(opcional)'}
            </label>
            <input
              id="email"
              type="email"
              required={req('email')}
              maxLength={120}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-slate-700">
              Telefone *
            </label>
            <input
              id="phone"
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(maskPhone(e.target.value))}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label htmlFor="cpf" className="block text-sm font-medium text-slate-700">
              CPF {req('cpf') ? '*' : '(opcional)'}
            </label>
            <input
              id="cpf"
              type="text"
              inputMode="numeric"
              value={cpf}
              onChange={(e) => setCpf(maskCpf(e.target.value))}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="mt-1 text-xs text-slate-500">
              Se você já é paciente da clínica, informe seu CPF para reaproveitar seu cadastro.
            </p>
          </div>
          <div>
            <label htmlFor="birth_date" className="block text-sm font-medium text-slate-700">
              Data de nascimento {req('birth_date') ? '*' : '(opcional)'}
            </label>
            <input
              id="birth_date"
              type="date"
              required={req('birth_date')}
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-input text-primary focus:ring-primary"
          />
          <span>
            Li e aceito a{' '}
            <a
              href={`/agendar/${slug}/privacidade`}
              target="_blank"
              rel="noreferrer"
              className="text-link underline-offset-2 hover:underline"
            >
              política de privacidade
            </a>{' '}
            e autorizo o tratamento dos meus dados para fins de agendamento.
          </span>
        </label>
      </section>

      <div className="rounded-lg border border-border bg-card p-4">
        <TurnstileWidget
          onToken={(t) => setTurnstileToken(t)}
          onExpired={() => setTurnstileToken(null)}
          onError={() => setTurnstileToken(null)}
        />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !consent || !turnstileToken}
        className="w-full rounded-md bg-brand-strong px-4 py-3 text-sm font-semibold text-brand-foreground transition hover:bg-brand disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Agendando...' : 'Confirmar agendamento'}
      </button>
    </form>
  )
}

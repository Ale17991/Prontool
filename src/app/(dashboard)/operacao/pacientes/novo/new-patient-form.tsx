'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
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

export interface HealthPlanOption {
  id: string
  name: string
}

export function NewPatientForm({ healthPlans }: { healthPlans: HealthPlanOption[] }) {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [cpf, setCpf] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [planId, setPlanId] = useState<string>('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const cpfDigits = cpf.replace(/\D/g, '')
    if (fullName.trim().length < 2) {
      setError('Informe o nome completo.')
      return
    }
    if (cpfDigits.length !== 11) {
      setError('CPF precisa ter 11 dígitos.')
      return
    }
    if (!planId) {
      setError('Selecione um plano de saúde ou "Sem plano (particular)".')
      return
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('E-mail inválido.')
      return
    }

    setPending(true)
    try {
      const res = await fetch('/api/pacientes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          cpf: cpfDigits,
          phone: phone.trim() || null,
          email: email.trim() || null,
          birth_date: birthDate || null,
          plan_id: planId === '__none__' ? null : planId,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        patientId?: string
        ghlSynced?: boolean
        error?: { message?: string }
      }
      if (!res.ok || !body.patientId) {
        setError(body.error?.message ?? 'Falha ao criar paciente.')
        return
      }
      router.push(`/operacao/pacientes/${body.patientId}`)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="full_name">Nome completo</Label>
        <Input
          id="full_name"
          required
          autoFocus
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cpf">CPF</Label>
        <Input
          id="cpf"
          required
          inputMode="numeric"
          placeholder="000.000.000-00"
          value={cpf}
          onChange={(e) => setCpf(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="phone">Telefone</Label>
        <Input
          id="phone"
          inputMode="tel"
          placeholder="(11) 99999-9999"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">E-mail (opcional)</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="birth_date">Data de nascimento (opcional)</Label>
        <Input
          id="birth_date"
          type="date"
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
        />
      </div>

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
            <Link href="/cadastros/planos" className="underline">
              Cadastrar plano
            </Link>
            {' '}ou escolha &quot;Sem plano (particular)&quot;.
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="md:col-span-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="md:col-span-2 flex justify-end">
        <Button type="submit" disabled={pending} className="gap-2">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar paciente
        </Button>
      </div>
    </form>
  )
}

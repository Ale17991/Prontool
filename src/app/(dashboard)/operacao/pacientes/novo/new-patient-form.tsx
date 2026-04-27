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

const UFS = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
]

function formatCep(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits
}

export function NewPatientForm({ healthPlans }: { healthPlans: HealthPlanOption[] }) {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [cpf, setCpf] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [planId, setPlanId] = useState<string>('')

  const [cep, setCep] = useState('')
  const [street, setStreet] = useState('')
  const [number, setNumber] = useState('')
  const [complement, setComplement] = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState<string>('')
  const [cepLookup, setCepLookup] = useState<'idle' | 'loading' | 'not-found' | 'error'>(
    'idle',
  )

  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCepChange(raw: string) {
    const formatted = formatCep(raw)
    setCep(formatted)
    const digits = formatted.replace(/\D/g, '')
    if (digits.length !== 8) {
      setCepLookup('idle')
      return
    }
    setCepLookup('loading')
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
      if (!res.ok) {
        setCepLookup('error')
        return
      }
      const body = (await res.json()) as {
        erro?: boolean
        logradouro?: string
        bairro?: string
        localidade?: string
        uf?: string
      }
      if (body.erro) {
        setCepLookup('not-found')
        return
      }
      setCepLookup('idle')
      if (body.logradouro && !street) setStreet(body.logradouro)
      if (body.bairro && !neighborhood) setNeighborhood(body.bairro)
      if (body.localidade && !city) setCity(body.localidade)
      if (body.uf && !state) setState(body.uf)
    } catch {
      setCepLookup('error')
    }
  }

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
      const cepDigits = cep.replace(/\D/g, '')
      const address = {
        cep: cepDigits || null,
        street: street.trim() || null,
        number: number.trim() || null,
        complement: complement.trim() || null,
        neighborhood: neighborhood.trim() || null,
        city: city.trim() || null,
        state: state || null,
      }
      const hasAnyAddress = Object.values(address).some((v) => v)
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
          address: hasAnyAddress ? address : null,
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
    <form onSubmit={onSubmit} className="space-y-6">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <p className="md:col-span-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
          Dados pessoais
        </p>
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
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-6">
        <p className="md:col-span-6 text-[10px] font-black uppercase tracking-widest text-slate-400">
          Endereço (opcional)
        </p>

        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="cep">CEP</Label>
          <Input
            id="cep"
            inputMode="numeric"
            placeholder="00000-000"
            value={cep}
            onChange={(e) => void handleCepChange(e.target.value)}
            maxLength={9}
          />
          {cepLookup === 'loading' ? (
            <p className="text-[11px] text-slate-500">Buscando CEP…</p>
          ) : cepLookup === 'not-found' ? (
            <p className="text-[11px] text-amber-700">CEP não encontrado no ViaCEP.</p>
          ) : cepLookup === 'error' ? (
            <p className="text-[11px] text-amber-700">
              Não foi possível consultar o CEP — preencha manualmente.
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5 md:col-span-3">
          <Label htmlFor="street">Rua / logradouro</Label>
          <Input id="street" value={street} onChange={(e) => setStreet(e.target.value)} />
        </div>

        <div className="space-y-1.5 md:col-span-1">
          <Label htmlFor="number">Número</Label>
          <Input id="number" value={number} onChange={(e) => setNumber(e.target.value)} />
        </div>

        <div className="space-y-1.5 md:col-span-3">
          <Label htmlFor="complement">Complemento</Label>
          <Input
            id="complement"
            value={complement}
            onChange={(e) => setComplement(e.target.value)}
          />
        </div>

        <div className="space-y-1.5 md:col-span-3">
          <Label htmlFor="neighborhood">Bairro</Label>
          <Input
            id="neighborhood"
            value={neighborhood}
            onChange={(e) => setNeighborhood(e.target.value)}
          />
        </div>

        <div className="space-y-1.5 md:col-span-4">
          <Label htmlFor="city">Cidade</Label>
          <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="state">Estado</Label>
          <Select value={state} onValueChange={setState}>
            <SelectTrigger id="state">
              <SelectValue placeholder="UF" />
            </SelectTrigger>
            <SelectContent>
              {UFS.map((uf) => (
                <SelectItem key={uf} value={uf}>
                  {uf}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending} className="gap-2">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar paciente
        </Button>
      </div>
    </form>
  )
}

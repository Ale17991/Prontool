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

  const [sex, setSex] = useState<string>('')
  const [socialName, setSocialName] = useState('')
  const [motherName, setMotherName] = useState('')
  const [rg, setRg] = useState('')
  const [insuranceCardNumber, setInsuranceCardNumber] = useState('')
  const [emergencyContactName, setEmergencyContactName] = useState('')
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('')
  const [guardianName, setGuardianName] = useState('')
  const [guardianCpf, setGuardianCpf] = useState('')
  const [guardianRelationship, setGuardianRelationship] = useState('')

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
    // Dados exigidos pela Memed — obrigatórios em todo cadastro.
    if (cpfDigits.length !== 11) {
      setError('Informe um CPF válido (11 dígitos).')
      return
    }
    if (!phone.trim()) {
      setError('Informe o celular.')
      return
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Informe um e-mail válido.')
      return
    }
    if (!birthDate) {
      setError('Informe a data de nascimento.')
      return
    }
    if (!planId) {
      setError('Selecione um plano de saúde ou "Sem plano (particular)".')
      return
    }

    setPending(true)
    // Flag para distinguir "submit deu certo, vai navegar" de "submit
    // falhou ou retornou erro". No primeiro caso, `pending` continua true
    // para o componente desmontar sem dar chance de double-submit; no
    // segundo, o `finally` re-habilita o botão para o usuário corrigir.
    let success = false
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
          phone: phone.trim(),
          email: email.trim(),
          birth_date: birthDate,
          plan_id: planId === '__none__' ? null : planId,
          sex: sex || null,
          social_name: socialName.trim() || null,
          mother_name: motherName.trim() || null,
          rg: rg.trim() || null,
          insurance_card_number: insuranceCardNumber.trim() || null,
          emergency_contact_name: emergencyContactName.trim() || null,
          emergency_contact_phone: emergencyContactPhone.trim() || null,
          guardian_name: guardianName.trim() || null,
          guardian_cpf: guardianCpf.replace(/\D/g, '') || null,
          guardian_relationship: guardianRelationship.trim() || null,
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
      success = true
      router.push(`/operacao/pacientes/${body.patientId}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      // Só re-habilita quando deu erro/cancel. No sucesso, o componente
      // vai desmontar pela navegação — manter pending=true evita
      // double-submit durante o intervalo entre router.push e a navegação.
      if (!success) setPending(false)
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
          <Label htmlFor="phone">Celular</Label>
          <Input
            id="phone"
            required
            inputMode="tel"
            placeholder="(11) 99999-9999"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="birth_date">Data de nascimento</Label>
          <Input
            id="birth_date"
            type="date"
            required
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sex">Sexo (opcional)</Label>
          <Select value={sex} onValueChange={setSex}>
            <SelectTrigger id="sex">
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
          <Label htmlFor="social_name">Nome social (opcional)</Label>
          <Input
            id="social_name"
            value={socialName}
            onChange={(e) => setSocialName(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mother_name">Nome da mãe (opcional)</Label>
          <Input
            id="mother_name"
            value={motherName}
            onChange={(e) => setMotherName(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rg">RG (opcional)</Label>
          <Input id="rg" value={rg} onChange={(e) => setRg(e.target.value)} />
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
              <Link href="/configuracoes/convenios" className="underline">
                Cadastrar plano
              </Link>
              {' '}ou escolha &quot;Sem plano (particular)&quot;.
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="insurance_card_number">
            Carteirinha do convênio (opcional)
          </Label>
          <Input
            id="insurance_card_number"
            placeholder="Número da carteira / matrícula"
            value={insuranceCardNumber}
            onChange={(e) => setInsuranceCardNumber(e.target.value)}
          />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <p className="md:col-span-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
          Contato de emergência (opcional)
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="emergency_contact_name">Nome</Label>
          <Input
            id="emergency_contact_name"
            value={emergencyContactName}
            onChange={(e) => setEmergencyContactName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="emergency_contact_phone">Telefone</Label>
          <Input
            id="emergency_contact_phone"
            inputMode="tel"
            placeholder="(11) 99999-9999"
            value={emergencyContactPhone}
            onChange={(e) => setEmergencyContactPhone(e.target.value)}
          />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <p className="md:col-span-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
          Responsável legal (opcional — menores ou incapazes)
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="guardian_name">Nome do responsável</Label>
          <Input
            id="guardian_name"
            value={guardianName}
            onChange={(e) => setGuardianName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="guardian_cpf">CPF do responsável</Label>
          <Input
            id="guardian_cpf"
            inputMode="numeric"
            placeholder="000.000.000-00"
            value={guardianCpf}
            onChange={(e) => setGuardianCpf(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="guardian_relationship">Parentesco</Label>
          <Input
            id="guardian_relationship"
            placeholder="Mãe, pai, tutor…"
            value={guardianRelationship}
            onChange={(e) => setGuardianRelationship(e.target.value)}
          />
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
            <p className="text-[11px] text-[hsl(var(--warning-foreground))]">CEP não encontrado no ViaCEP.</p>
          ) : cepLookup === 'error' ? (
            <p className="text-[11px] text-[hsl(var(--warning-foreground))]">
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
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
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

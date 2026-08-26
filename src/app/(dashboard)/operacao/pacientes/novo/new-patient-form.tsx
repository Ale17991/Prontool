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
import {
  describeMissingFields,
  missingRequiredPatientFields,
  patientFieldPolicy,
  type PatientField,
} from '@/lib/core/patients/required-fields'
import {
  MARITAL_STATUS_LABEL,
  MARITAL_STATUS_VALUES,
  OCCUPATION_MAX_LENGTH,
  PATIENT_RACE_LABEL,
  PATIENT_RACE_VALUES,
} from '@/lib/core/patients/demographics'

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

/** Asterisco só quando a política da clínica realmente exige o campo. */
function Req({ on }: { on: boolean }) {
  return on ? (
    <span className="text-rose-500" title="Obrigatório">
      *
    </span>
  ) : (
    <span className="text-[11px] font-normal text-slate-400">(opcional)</span>
  )
}

function formatCep(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits
}

export function NewPatientForm({
  healthPlans,
  memedPrescriber,
}: {
  healthPlans: HealthPlanOption[]
  memedPrescriber: boolean
}) {
  const policy = patientFieldPolicy(memedPrescriber)
  const req = (f: PatientField) => policy.required.includes(f)
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [cpf, setCpf] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [planId, setPlanId] = useState<string>('')

  const [sex, setSex] = useState<string>('')
  const [maritalStatus, setMaritalStatus] = useState<string>('')
  const [race, setRace] = useState<string>('')
  const [occupation, setOccupation] = useState('')
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
  const [cepLookup, setCepLookup] = useState<'idle' | 'loading' | 'not-found' | 'error'>('idle')

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
    // Formato é sempre checado quando o campo tem conteúdo; a obrigatoriedade
    // vem da política da clínica (base = nome + telefone; prescritora Memed
    // acrescenta CPF, e-mail e nascimento).
    if (cpfDigits.length > 0 && cpfDigits.length !== 11) {
      setError('CPF deve ter 11 dígitos quando preenchido (ou deixe em branco).')
      return
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Informe um e-mail válido (ou deixe em branco).')
      return
    }
    const missing = missingRequiredPatientFields(
      {
        full_name: fullName,
        phone,
        cpf: cpfDigits,
        email,
        birth_date: birthDate,
      },
      policy,
    )
    if (missing.length > 0) {
      setError(
        policy.memedPrescriber
          ? `Preencha ${describeMissingFields(missing)} — obrigatórios porque esta clínica prescreve pela Memed.`
          : `Preencha ${describeMissingFields(missing)}.`,
      )
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
          cpf: cpfDigits || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          birth_date: birthDate || null,
          // Sem escolha explícita = particular. Plano deixou de segurar o
          // cadastro: o mínimo para existir na base é identificação, não
          // convênio — quem paga como se resolve na hora do atendimento.
          plan_id: planId && planId !== '__none__' ? planId : null,
          sex: sex || null,
          marital_status: maritalStatus || null,
          race: race || null,
          occupation: occupation.trim() || null,
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
        {memedPrescriber ? (
          <p className="md:col-span-2 rounded-md bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
            Esta clínica prescreve pela Memed: CPF, e-mail e data de nascimento são obrigatórios no
            cadastro, senão a receita falha na hora da consulta.
          </p>
        ) : null}

        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="full_name">
            Nome completo <Req on={req('full_name')} />
          </Label>
          <Input
            id="full_name"
            required
            autoFocus
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cpf">
            CPF <Req on={req('cpf')} />
          </Label>
          <Input
            id="cpf"
            inputMode="numeric"
            placeholder="000.000.000-00"
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="phone">
            Celular <Req on={req('phone')} />
          </Label>
          <Input
            id="phone"
            inputMode="tel"
            placeholder="(11) 99999-9999"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">
            E-mail <Req on={req('email')} />
          </Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="birth_date">
            Data de nascimento <Req on={req('birth_date')} />
          </Label>
          <Input
            id="birth_date"
            type="date"
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
          <Label htmlFor="marital_status">Estado civil (opcional)</Label>
          <Select value={maritalStatus} onValueChange={setMaritalStatus}>
            <SelectTrigger id="marital_status">
              <SelectValue placeholder="Selecione…" />
            </SelectTrigger>
            <SelectContent>
              {MARITAL_STATUS_VALUES.map((v) => (
                <SelectItem key={v} value={v}>
                  {MARITAL_STATUS_LABEL[v]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="race">Raça/cor (opcional)</Label>
          <Select value={race} onValueChange={setRace}>
            <SelectTrigger id="race">
              <SelectValue placeholder="Selecione…" />
            </SelectTrigger>
            <SelectContent>
              {PATIENT_RACE_VALUES.map((v) => (
                <SelectItem key={v} value={v}>
                  {PATIENT_RACE_LABEL[v]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Autodeclarada: preenchida por observação de quem atende, ela
              deixa de medir o que se propõe a medir. */}
          <p className="text-[11px] text-slate-400">Como o paciente se declara.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="occupation">Ocupação (opcional)</Label>
          <Input
            id="occupation"
            maxLength={OCCUPATION_MAX_LENGTH}
            placeholder="Professora, aposentado, estudante…"
            value={occupation}
            onChange={(e) => setOccupation(e.target.value)}
          />
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
          <Label htmlFor="plan_id">Plano de saúde (opcional)</Label>
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
              </Link>{' '}
              ou escolha &quot;Sem plano (particular)&quot;.
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="insurance_card_number">Carteirinha do convênio (opcional)</Label>
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
            <p className="text-[11px] text-[hsl(var(--warning-foreground))]">
              CEP não encontrado no ViaCEP.
            </p>
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

'use client'

import { useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function IntakeForm({ token, clinicName }: { token: string; clinicName: string }) {
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [ecName, setEcName] = useState('')
  const [ecPhone, setEcPhone] = useState('')
  const [cep, setCep] = useState('')
  const [street, setStreet] = useState('')
  const [number, setNumber] = useState('')
  const [complement, setComplement] = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    setPending(true)
    try {
      const res = await fetch(`/api/public/cadastro/${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          phone, email,
          emergencyContactName: ecName,
          emergencyContactPhone: ecPhone,
          address: { cep, street, number, complement, neighborhood, city, state },
        }),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(b.error?.message ?? 'Não foi possível enviar. Tente novamente.')
        return
      }
      setDone(true)
    } finally {
      setPending(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <CheckCircle2 className="mx-auto h-10 w-10 text-success-text" />
        <h1 className="mt-3 text-lg font-bold text-slate-900">Dados enviados!</h1>
        <p className="mt-2 text-sm text-slate-500">
          Obrigado. Suas informações foram recebidas pela {clinicName}.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-bold text-slate-900">Complete seu cadastro</h1>
      <p className="mt-1 text-sm text-slate-500">{clinicName}</p>

      <div className="mt-5 space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>Telefone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000" />
          </div>
          <div>
            <Label>E-mail</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
          </div>
        </div>

        <p className="pt-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">Endereço</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><Label>CEP</Label><Input value={cep} onChange={(e) => setCep(e.target.value)} /></div>
          <div className="sm:col-span-2"><Label>Rua</Label><Input value={street} onChange={(e) => setStreet(e.target.value)} /></div>
          <div><Label>Número</Label><Input value={number} onChange={(e) => setNumber(e.target.value)} /></div>
          <div className="sm:col-span-2"><Label>Complemento</Label><Input value={complement} onChange={(e) => setComplement(e.target.value)} /></div>
          <div><Label>Bairro</Label><Input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} /></div>
          <div><Label>Cidade</Label><Input value={city} onChange={(e) => setCity(e.target.value)} /></div>
          <div><Label>UF</Label><Input value={state} onChange={(e) => setState(e.target.value)} maxLength={2} /></div>
        </div>

        <p className="pt-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">Contato de emergência</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><Label>Nome</Label><Input value={ecName} onChange={(e) => setEcName(e.target.value)} /></div>
          <div><Label>Telefone</Label><Input value={ecPhone} onChange={(e) => setEcPhone(e.target.value)} /></div>
        </div>

        {error ? <p className="text-sm font-semibold text-destructive">{error}</p> : null}

        <Button type="button" onClick={submit} disabled={pending} className="w-full gap-2">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Enviar dados
        </Button>
        <p className="text-center text-[11px] text-slate-400">
          Preencha apenas o que souber. Campos em branco não alteram seu cadastro.
        </p>
      </div>
    </div>
  )
}

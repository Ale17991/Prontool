'use client'

import { useState, useTransition } from 'react'
import { Building2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { adminUpdateClinicProfileAction } from '../../usuarios/actions'

interface Props {
  tenantId: string
  initial: { displayName: string; cnpj: string | null; phone: string | null; email: string | null }
}

/** Feature 043 (US4) — super-admin edita dados cadastrais da clínica pelo /admin. */
export function ClinicDataForm({ tenantId, initial }: Props) {
  const [name, setName] = useState(initial.displayName)
  const [cnpj, setCnpj] = useState(initial.cnpj ?? '')
  const [phone, setPhone] = useState(initial.phone ?? '')
  const [email, setEmail] = useState(initial.email ?? '')
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  function save(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    start(async () => {
      const res = await adminUpdateClinicProfileAction(tenantId, {
        displayName: name.trim(),
        cnpj: cnpj.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
      })
      setMsg(res.ok ? { kind: 'ok', text: 'Dados salvos.' } : { kind: 'err', text: res.error ?? 'Falha ao salvar.' })
    })
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
        <Building2 className="h-4 w-4 text-primary" /> Dados da clínica
      </h3>
      <form onSubmit={save} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label className="text-[11px] font-bold uppercase text-slate-500">Nome</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-[11px] font-bold uppercase text-slate-500">CNPJ</Label>
          <Input value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="só números" className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-[11px] font-bold uppercase text-slate-500">Telefone</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="sm:col-span-2">
          <Label className="text-[11px] font-bold uppercase text-slate-500">E-mail</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" size="sm" disabled={pending} className="gap-2">
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Salvar
          </Button>
          {msg ? (
            <span className={`text-xs font-semibold ${msg.kind === 'ok' ? 'text-success-text' : 'text-destructive'}`}>
              {msg.text}
            </span>
          ) : null}
        </div>
      </form>
    </div>
  )
}

'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TENANT_ROLES_ORDERED, labelForRole } from '@/lib/core/team/types'
import type { TenantRole } from '@/lib/db/types'

interface DoctorOption {
  id: string
  full_name: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function ManualUserDialog({ open, onOpenChange, onSuccess }: Props) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<TenantRole>('recepcionista')
  const [linkDoctor, setLinkDoctor] = useState(false)
  const [doctorId, setDoctorId] = useState<string>('')
  const [doctors, setDoctors] = useState<DoctorOption[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Carrega doctors disponíveis (sem login) quando o checkbox é marcado.
  useEffect(() => {
    if (!linkDoctor || !open) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/configuracoes/usuarios/doctors-disponiveis')
        if (!res.ok) return
        const list = (await res.json()) as DoctorOption[]
        if (!cancelled) setDoctors(list)
      } catch {
        // silencioso
      }
    })()
    return () => {
      cancelled = true
    }
  }, [linkDoctor, open])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const res = await fetch('/api/configuracoes/usuarios/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim(),
          password,
          phone: phone.trim() || null,
          role,
          doctor_id: linkDoctor && doctorId ? doctorId : null,
        }),
      })
      if (res.status === 201) {
        // Reset form
        setFullName('')
        setEmail('')
        setPassword('')
        setPhone('')
        setRole('recepcionista')
        setLinkDoctor(false)
        setDoctorId('')
        onSuccess()
        return
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string }
      }
      const code = body.error?.code
      if (code === 'USER_ALREADY_ACTIVE') setError('Esse e-mail já está vinculado ao tenant.')
      else if (code === 'DOCTOR_ALREADY_LINKED') setError('Este profissional já tem login vinculado.')
      else if (code === 'DOCTOR_NOT_FOUND') setError('Profissional não encontrado neste tenant.')
      else setError(body.error?.message ?? `HTTP ${res.status}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cadastrar usuário</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor="m-name" className="text-xs">Nome completo</Label>
            <Input id="m-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
          </div>
          <div>
            <Label htmlFor="m-email" className="text-xs">E-mail</Label>
            <Input id="m-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <p className="mt-0.5 text-[10px] text-slate-500">Será o login do usuário.</p>
          </div>
          <div>
            <Label htmlFor="m-pwd" className="text-xs">Senha inicial</Label>
            <Input id="m-pwd" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="mt-0.5 text-[10px] text-slate-500">
              Mínimo 8 caracteres. Comunique ao usuário para trocar depois em &quot;Meu Perfil&quot;.
            </p>
          </div>
          <div>
            <Label htmlFor="m-phone" className="text-xs">Telefone (opcional)</Label>
            <Input id="m-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
          </div>
          <div>
            <Label htmlFor="m-role" className="text-xs">Função</Label>
            <select
              id="m-role"
              value={role}
              onChange={(e) => setRole(e.target.value as TenantRole)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            >
              {TENANT_ROLES_ORDERED.map((r) => (
                <option key={r} value={r}>
                  {labelForRole(r)}
                </option>
              ))}
            </select>
          </div>

          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={linkDoctor}
              onChange={(e) => setLinkDoctor(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="font-semibold text-slate-900">Vincular a profissional</span>
              <span className="block text-slate-500">
                Associa o login a um profissional cadastrado (para comissões e relatórios &quot;meus atendimentos&quot;).
              </span>
            </span>
          </label>

          {linkDoctor ? (
            <div>
              <Label htmlFor="m-doctor" className="text-xs">Profissional vinculado</Label>
              <select
                id="m-doctor"
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              >
                <option value="">Selecione…</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name}
                  </option>
                ))}
              </select>
              {doctors.length === 0 ? (
                <p className="mt-0.5 text-[10px] text-amber-600">
                  Nenhum profissional disponível (todos já têm login vinculado ou não há profissionais cadastrados).
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p className="rounded-md border border-rose-100 bg-rose-50 p-3 text-xs font-medium text-rose-700">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || (linkDoctor && !doctorId)}>
              {pending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              Cadastrar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

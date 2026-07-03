'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TENANT_ROLES_ORDERED, labelForRole, type TeamMember } from '@/lib/core/team/types'
import type { TenantRole } from '@/lib/db/types'

interface Props {
  target: TeamMember
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function EditUserDialog({ target, onOpenChange, onSuccess }: Props) {
  const [fullName, setFullName] = useState(target.fullName ?? '')
  const [phone, setPhone] = useState(target.phone ?? '')
  const [role, setRole] = useState<TenantRole>(target.role)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = fullName.trim()
    if (name.length < 1) {
      setError('Informe o nome.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      // 1. Função (se mudou) — usa o endpoint dedicado (guarda da última admin).
      if (role !== target.role) {
        const r = await fetch(`/api/configuracoes/usuarios/${target.userId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role }),
        })
        if (!r.ok) {
          const b = (await r.json().catch(() => ({}))) as {
            error?: { code?: string; message?: string }
          }
          setError(
            b.error?.code === 'LAST_ADMIN'
              ? 'Não é possível rebaixar a única admin ativa.'
              : (b.error?.message ?? `HTTP ${r.status}`),
          )
          return
        }
      }
      // 2. Nome + telefone.
      const res = await fetch(`/api/configuracoes/usuarios/${target.userId}/perfil`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: name, phone: phone.trim() || null }),
      })
      if (res.ok) {
        onSuccess()
        return
      }
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      setError(body.error?.message ?? `HTTP ${res.status}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar dados do usuário</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <p className="text-xs text-slate-500">
            E-mail: <strong>{target.email}</strong> (não editável aqui)
          </p>
          <div className="space-y-2">
            <Label htmlFor="edit-fullname">Nome completo</Label>
            <Input
              id="edit-fullname"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={200}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="edit-phone">Telefone</Label>
              <Input
                id="edit-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={20}
                placeholder="(00) 00000-0000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">Função</Label>
              <select
                id="edit-role"
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
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
              Salvar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

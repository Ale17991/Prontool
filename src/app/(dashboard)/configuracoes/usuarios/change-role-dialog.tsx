'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { TENANT_ROLES_ORDERED, labelForRole, type TeamMember } from '@/lib/core/team/types'
import type { TenantRole } from '@/lib/db/types'

interface Props {
  target: TeamMember
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function ChangeRoleDialog({ target, onOpenChange, onSuccess }: Props) {
  const [role, setRole] = useState<TenantRole>(target.role)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (role === target.role) {
      onOpenChange(false)
      return
    }
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/configuracoes/usuarios/${target.userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      if (res.ok) {
        onSuccess()
        return
      }
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }
      const code = body.error?.code
      if (code === 'LAST_ADMIN') setError('Não é possível rebaixar a única admin ativa')
      else setError(body.error?.message ?? `HTTP ${res.status}`)
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
          <DialogTitle>Alterar função</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <p className="text-xs text-slate-500">
            Usuário: <strong>{target.fullName ?? target.email}</strong>
          </p>
          <div>
            <Label htmlFor="role-select">Nova função</Label>
            <select
              id="role-select"
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
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
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

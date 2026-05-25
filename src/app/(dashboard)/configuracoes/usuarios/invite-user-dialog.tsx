'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  TENANT_ROLES_ORDERED,
  labelForRole,
} from '@/lib/core/team/types'
import type { TenantRole } from '@/lib/db/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function InviteUserDialog({ open, onOpenChange, onSuccess }: Props) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<TenantRole>('recepcionista')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/configuracoes/usuarios/convite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      })
      if (res.status === 201) {
        setEmail('')
        setRole('recepcionista')
        onSuccess()
        return
      }
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }
      const code = body.error?.code
      if (code === 'USER_ALREADY_ACTIVE') setError('Esse e-mail já está vinculado à clínica')
      else setError(body.error?.message ?? `HTTP ${res.status}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar usuário</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="invite-email">E-mail</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="invite-role">Função</Label>
            <select
              id="invite-role"
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
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !email}>
              {busy ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
              Enviar convite
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

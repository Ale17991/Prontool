'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { TeamMember } from '@/lib/core/team/types'

interface Props {
  target: TeamMember
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function ChangeStatusDialog({ target, onOpenChange, onSuccess }: Props) {
  const nextStatus = target.status === 'disabled' ? 'active' : 'disabled'
  const isDisable = nextStatus === 'disabled'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/configuracoes/usuarios/${target.userId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      if (res.ok) {
        onSuccess()
        return
      }
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }
      const code = body.error?.code
      if (code === 'CANNOT_DISABLE_SELF') setError('Você não pode desativar a si mesmo')
      else if (code === 'LAST_ADMIN') setError('Não é possível desativar a única admin ativa')
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
          <DialogTitle>{isDisable ? 'Desativar usuário' : 'Reativar usuário'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            {isDisable
              ? 'O usuário perderá acesso ao tenant na próxima requisição. Histórico fica preservado.'
              : 'O vínculo será restabelecido — o usuário volta a ter acesso ao tenant. Não enviamos novo convite.'}
          </p>
          <p className="text-xs text-slate-500">
            Usuário: <strong>{target.fullName ?? target.email}</strong>
          </p>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={busy}
              className={isDisable ? 'bg-red-600 text-white hover:bg-red-700' : ''}
            >
              {busy ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
              {isDisable ? 'Desativar' : 'Reativar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

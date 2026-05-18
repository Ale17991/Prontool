'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PASSWORD_MIN_LENGTH, validatePasswordStrength } from '@/lib/core/user-profile/types'

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (newPassword !== confirmPassword) {
      setError('As novas senhas não conferem')
      return
    }
    const policy = validatePasswordStrength(newPassword)
    if (policy) {
      setError(
        policy.reason === 'too_short'
          ? `Mínimo de ${PASSWORD_MIN_LENGTH} caracteres`
          : policy.reason === 'missing_letter'
            ? 'Inclua ao menos uma letra'
            : 'Inclua ao menos um número',
      )
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/configuracoes/perfil/senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      if (res.status === 204) {
        setSuccess(true)
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        return
      }
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }
      const code = body.error?.code
      if (code === 'INVALID_CURRENT_PASSWORD') setError('Senha atual incorreta')
      else if (code === 'WEAK_PASSWORD') setError('Senha fraca — não atende à política')
      else setError(body.error?.message ?? `HTTP ${res.status}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div>
          <h2 className="text-base font-bold text-slate-900">Trocar senha</h2>
          <p className="text-xs text-slate-500">
            Mínimo {PASSWORD_MIN_LENGTH} caracteres, com letra e número.
          </p>
        </div>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <Label htmlFor="currentPassword">Senha atual</Label>
            <Input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div>
            <Label htmlFor="newPassword">Nova senha</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div>
            <Label htmlFor="confirmPassword">Confirmar nova senha</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="md:col-span-3 flex items-center justify-between">
            <div className="text-xs">
              {success ? <span className="text-success-strong">Senha alterada com sucesso</span> : null}
              {error ? <span className="text-destructive">{error}</span> : null}
            </div>
            <Button type="submit" disabled={busy || !currentPassword || !newPassword}>
              {busy ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
              Trocar senha
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

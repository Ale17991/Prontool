'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { Stethoscope } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BackLink } from '@/components/ui/back-link'

/**
 * Pedido de redefinição de senha. A tela é o par público de `/redefinir-senha`:
 * aqui se pede o link, lá se escolhe a senha nova.
 *
 * Depois de enviar, a tela NÃO volta ao formulário. Ela fica no aviso, porque
 * o certo a fazer em seguida é abrir o e-mail — remontar o campo convida a
 * pedir de novo, e pedir de novo invalida o link que acabou de chegar (cada
 * novo link derruba o anterior).
 */
export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/esqueci-senha', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        message?: string
        error?: { message?: string }
      }
      if (!res.ok) {
        setError(body.error?.message ?? 'Não foi possível enviar o e-mail. Tente novamente.')
        return
      }
      setSent(body.message ?? 'Se houver uma conta com esse e-mail, enviamos um link.')
    } catch {
      setError('Não foi possível enviar o e-mail. Verifique sua conexão e tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary p-6 font-sans">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-white p-8 shadow-xl">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand shadow-lg shadow-brand/25">
            <Stethoscope className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight text-slate-900">
              Esqueci minha senha
            </h1>
            <p className="text-xs text-slate-500">Enviamos um link para o seu e-mail</p>
          </div>
        </div>

        {sent ? (
          <div className="space-y-4">
            <p className="rounded-md border border-success/30 bg-success-bg p-3 text-sm font-medium text-success-text">
              {sent}
            </p>
            <Button variant="outline" className="w-full" asChild>
              <Link href="/login">Voltar ao login</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail da sua conta</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@clinica.com.br"
              />
            </div>
            {error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Enviando…' : 'Enviar link de redefinição'}
            </Button>
            <div className="pt-2">
              <BackLink href="/login">Voltar ao login</BackLink>
            </div>
          </form>
        )}
      </div>
    </main>
  )
}

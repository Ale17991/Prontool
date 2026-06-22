'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Stethoscope } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Destino do link de recuperação de senha. O Supabase volta do endpoint de
 * verify com a sessão de recovery (no hash da URL); o browser client detecta
 * automaticamente (detectSessionInUrl) e aqui o usuário define a nova senha.
 */
export default function RedefinirSenhaPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let supabase: ReturnType<typeof createSupabaseBrowserClient>
    try {
      supabase = createSupabaseBrowserClient()
    } catch {
      setReady(true)
      return
    }
    // A sessão pode demorar um tick para ser captada do hash.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setHasSession(true)
    })
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) setHasSession(true)
      setReady(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('A senha deve ter ao menos 8 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não conferem.')
      return
    }
    setLoading(true)
    try {
      const supabase = createSupabaseBrowserClient()
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      setDone(true)
      setTimeout(() => {
        router.push('/login')
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível redefinir a senha.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6 font-sans">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/20">
            <Stethoscope className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight text-slate-900">Redefinir senha</h1>
            <p className="text-xs text-slate-500">Defina uma nova senha de acesso</p>
          </div>
        </div>

        {done ? (
          <p className="rounded-md border border-success/30 bg-success-bg p-3 text-sm font-medium text-success-text">
            Senha redefinida com sucesso. Redirecionando para o login…
          </p>
        ) : !ready ? (
          <p className="text-sm text-slate-500">Carregando…</p>
        ) : !hasSession ? (
          <div className="space-y-3">
            <p className="rounded-md border border-warning/30 bg-[hsl(var(--warning)/0.1)] p-3 text-sm text-[hsl(var(--warning-foreground))]">
              Link inválido ou expirado. Solicite um novo link de recuperação ao administrador da
              clínica.
            </p>
            <Button variant="outline" className="w-full" onClick={() => router.push('/login')}>
              Voltar ao login
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Nova senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirmar nova senha</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Salvando…' : 'Redefinir senha'}
            </Button>
          </form>
        )}
      </div>
    </main>
  )
}

'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, LockKeyhole } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Feature 030 — formulário de login do paciente (CPF + nascimento).
 *
 * - Inputs aceitam só dígitos (máscara leve inline);
 * - consentimento LGPD obrigatório antes de enviar (FR-005);
 * - mensagens de erro são as do servidor — genéricas por contrato (FR-019);
 * - 429 mostra orientação de aguardar (FR-017).
 */

export function PatientLoginForm({ slug }: { slug: string }) {
  const router = useRouter()
  const [cpf, setCpf] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [consent, setConsent] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cpfDigits = cpf.replace(/\D/g, '')
  const birthDigits = birthdate.replace(/\D/g, '')
  const canSubmit = cpfDigits.length === 11 && birthDigits.length === 8 && consent && !pending

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    setPending(true)
    try {
      const res = await fetch('/api/paciente/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug,
          cpf: cpfDigits,
          birthdate: birthDigits,
          lgpd_consent: true,
        }),
      })
      if (res.ok) {
        router.push(`/paciente/${slug}/painel`)
        router.refresh()
        return
      }
      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as { retryAfter?: number }
        const min = Math.max(1, Math.ceil((body.retryAfter ?? 900) / 60))
        setError(`Muitas tentativas. Aguarde cerca de ${min} minuto(s) e tente novamente.`)
        return
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string }
      }
      setError(body.error?.message ?? 'CPF ou data de nascimento inválidos.')
    } catch {
      setError('Não foi possível conectar. Tente novamente.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <LockKeyhole className="h-4 w-4 text-primary" />
          Acesse seus dados
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pp_login">Login</Label>
            <Input
              id="pp_login"
              inputMode="numeric"
              autoComplete="username"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pp_password">Senha</Label>
            <Input
              id="pp_password"
              type="password"
              autoComplete="current-password"
              value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
            />
          </div>

          <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-600">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-primary"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              Autorizo o acesso aos meus dados de saúde neste portal, conforme a
              Lei Geral de Proteção de Dados (LGPD). Os dados exibidos são
              somente para minha consulta pessoal e cada acesso é registrado por
              segurança.
            </span>
          </label>

          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full gap-2" disabled={!canSubmit}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Entrar
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function GoogleAgendaCard({
  configured,
  connected,
  needsReconnect,
  email,
}: {
  configured: boolean
  connected: boolean
  needsReconnect: boolean
  email: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function connect() {
    window.location.href = '/api/oauth/google-calendar/authorize'
  }

  function disconnect() {
    setError(null)
    startTransition(async () => {
      const res = await fetch('/api/oauth/google-calendar/disconnect', { method: 'POST' })
      if (!res.ok) {
        setError('Não foi possível desconectar.')
        return
      }
      router.refresh()
    })
  }

  if (!configured) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 py-5 text-sm text-slate-600">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <p>
            A integração com o Google Agenda ainda não foi configurada no ambiente (variáveis
            <code className="mx-1 rounded bg-slate-100 px-1">GOOGLE_*</code>). Fale com o administrador
            do sistema.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Conexão</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {connected ? (
          <>
            <div className="flex items-center gap-2 text-sm text-success-strong">
              <CheckCircle2 className="h-5 w-5" />
              <span>
                Conectado{email ? <> como <strong>{email}</strong></> : null}.
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Novos atendimentos para você criam um evento na sua agenda. Estornos removem o evento.
            </p>
            <Button size="sm" variant="outline" onClick={disconnect} disabled={pending}>
              {pending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
              Desconectar
            </Button>
          </>
        ) : (
          <>
            {needsReconnect ? (
              <div className="flex items-center gap-2 text-sm text-amber-600">
                <AlertTriangle className="h-5 w-5" />
                <span>Sua conexão expirou. Reconecte para voltar a sincronizar.</span>
              </div>
            ) : (
              <p className="text-sm text-slate-600">Você ainda não conectou sua agenda Google.</p>
            )}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <Button size="sm" onClick={connect}>
              {needsReconnect ? 'Reconectar' : 'Conectar Google Agenda'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}

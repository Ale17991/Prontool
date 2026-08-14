'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Loader2, Unlink } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Conexão da agenda Google DESTE profissional. Mora no cadastro dele — e não
 * numa tela de conta — porque cada médico tem a sua própria agenda: é aqui que
 * se enxerga de quem é a que está conectada, ao lado do vínculo com usuário de
 * que o sync depende.
 *
 * A assimetria entre `isSelf` e admin não é excesso de zelo: consentimento
 * OAuth não se dá por procuração. Quem clica em conectar consente com a conta
 * Google logada NAQUELE navegador — se o admin pudesse conectar pelo médico,
 * gravaríamos o token do admin sob o usuário do médico, e os atendimentos dele
 * cairiam na agenda pessoal do admin, sem erro nenhum. Por isso o admin vê e
 * desconecta, mas nunca conecta por outro.
 */
export type GoogleNotice = 'connected' | 'scope_missing' | 'denied' | 'failed' | null

export function GoogleAgendaPanel({
  doctorId,
  linkedUserId,
  isSelf,
  configured,
  connected,
  needsReconnect,
  email,
  canManage,
  notice,
}: {
  doctorId: string
  /** `doctors.user_id` — sem ele o sync nem chega a tentar. */
  linkedUserId: string | null
  /** O usuário logado É este profissional (só ele pode consentir). */
  isSelf: boolean
  /** As env vars GOOGLE_* existem no ambiente. */
  configured: boolean
  connected: boolean
  needsReconnect: boolean
  email: string | null
  /** Admin: pode desconectar a agenda de outro (saída da clínica, revogação). */
  canManage: boolean
  /** Resultado da última volta do Google (vem por query string). */
  notice: GoogleNotice
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Sem parâmetro de profissional de propósito: a rota SEMPRE conecta o usuário
  // da sessão, e o callback reencontra o cadastro por esse usuário. Aceitar um
  // alvo aqui só criaria a ilusão de que dá para conectar pelo outro.
  function connect() {
    window.location.href = '/api/oauth/google-calendar/authorize'
  }

  function disconnect() {
    setError(null)
    start(async () => {
      try {
        const res = await fetch('/api/oauth/google-calendar/disconnect', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ doctor_id: doctorId }),
        })
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
          setError(b.error?.message ?? 'Não foi possível desconectar.')
          return
        }
        router.refresh()
      } catch {
        setError('Erro de rede.')
      }
    })
  }

  if (!configured) {
    return (
      <div className="flex items-start gap-2 text-xs text-slate-600">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <p>
          A integração com o Google Agenda ainda não foi configurada no ambiente (variáveis
          <code className="mx-1 rounded bg-slate-100 px-1">GOOGLE_*</code>). Fale com o
          administrador do sistema.
        </p>
      </div>
    )
  }

  // Sem usuário vinculado o sync desiste em silêncio — dizer isso aqui evita a
  // conclusão errada de "conectei e não funcionou".
  if (!linkedUserId) {
    return (
      <p className="text-xs text-amber-600">
        Vincule um usuário a este profissional (no painel acima) antes de conectar a agenda. Sem o
        vínculo, os atendimentos dele não têm para qual conta Google ir.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {/* Nada é mostrado no caso de sucesso: o próprio estado do card já diz
          "Agenda conectada", e repetir viraria ruído. */}
      {notice === 'scope_missing' ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <strong>Faltou a permissão de agenda.</strong> O Google mostra uma caixa de seleção por
            permissão, e a da agenda vem desmarcada — sem ela conseguimos ler seu e-mail, mas não
            criar eventos. Conecte de novo e <strong>marque a caixa da agenda</strong>. Nada foi
            salvo: melhor não conectado do que conectado e sem funcionar.
          </p>
        </div>
      ) : notice === 'denied' ? (
        <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <p>Você recusou o acesso na tela do Google. Nada foi alterado.</p>
        </div>
      ) : notice === 'failed' ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Não foi possível concluir a conexão com o Google. Tente novamente.</p>
        </div>
      ) : null}

      {connected ? (
        <>
          <div className="flex items-center gap-2 text-sm text-success-strong">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              Agenda conectada
              {email ? (
                <>
                  {' '}
                  como <strong>{email}</strong>
                </>
              ) : null}
              .
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Novos atendimentos deste profissional criam um evento nessa agenda; cancelamentos e
            estornos removem. Compromissos particulares dele aparecem como horário indisponível na
            agenda da clínica, sem detalhe.
          </p>
          {isSelf || canManage ? (
            <Button size="sm" variant="outline" onClick={disconnect} disabled={pending}>
              {pending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Unlink className="mr-1.5 h-3.5 w-3.5" />
              )}
              Desconectar
            </Button>
          ) : null}
        </>
      ) : needsReconnect ? (
        <>
          <div className="flex items-center gap-2 text-sm text-amber-600">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>A conexão expirou e a sincronização parou.</span>
          </div>
          {isSelf ? (
            <Button size="sm" onClick={connect}>
              Reconectar minha agenda
            </Button>
          ) : (
            <p className="text-xs text-slate-500">
              Só o próprio profissional pode reconectar, entrando no sistema com a conta dele e
              abrindo este cadastro.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-slate-600">Nenhuma agenda Google conectada.</p>
          {isSelf ? (
            <Button size="sm" onClick={connect}>
              Conectar minha agenda Google
            </Button>
          ) : (
            <p className="text-xs text-slate-500">
              Só o próprio profissional pode conectar — o Google pede o consentimento dele, na conta
              dele. Peça que entre no sistema e abra o próprio cadastro.
            </p>
          )}
        </>
      )}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

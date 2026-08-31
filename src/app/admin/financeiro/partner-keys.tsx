'use client'

import { useState, useTransition } from 'react'
import { Copy, KeyRound, Link2, Loader2, ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  PARTNER_SCOPES,
  SCOPE_LABEL,
  type PartnerApiKey,
  type PartnerScope,
} from '@/lib/core/partners/scopes'
import {
  adminGerarCredenciaisAction,
  adminListPartnerKeysAction,
  adminRevokePartnerKeyAction,
} from './billing-actions'

/**
 * Credenciais de API de um parceiro.
 *
 * Esta tela NUNCA vê o segredo. Gerar produz um LINK de uso único, e é o link
 * que se entrega — assim a credencial não passa pelo WhatsApp de quem opera o
 * /admin, onde ficaria no histórico de dois aparelhos para sempre. Revogar e
 * reemitir também acontecem aqui.
 */
export function PartnerKeysPanel({
  partnerId,
  partnerName,
}: {
  partnerId: string
  partnerName: string
}) {
  const [keys, setKeys] = useState<PartnerApiKey[] | null>(null)
  const [nome, setNome] = useState('produção')
  const [scopes, setScopes] = useState<PartnerScope[]>([...PARTNER_SCOPES])
  const [faixasIp, setFaixasIp] = useState('')
  const [validadeDias, setValidadeDias] = useState('365')
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [pendente, start] = useTransition()
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  function recarregar() {
    start(async () => {
      const res = await adminListPartnerKeysAction(partnerId)
      if (res.ok) setKeys(res.data ?? [])
      else setMsg({ kind: 'err', text: res.error })
    })
  }

  function gerar() {
    setMsg(null)
    start(async () => {
      const res = await adminGerarCredenciaisAction({
        partnerId,
        name: nome,
        scopes,
        faixasIp: faixasIp.trim() || undefined,
        validadeDias: Number(validadeDias) || 0,
      })
      if (!res.ok) {
        setMsg({ kind: 'err', text: res.error })
        return
      }
      setLink({ url: res.data!.url, expiresAt: res.data!.expiresAt })
      setCopiado(false)
      const lista = await adminListPartnerKeysAction(partnerId)
      if (lista.ok) setKeys(lista.data ?? [])
    })
  }

  function revogar(keyId: string) {
    start(async () => {
      const res = await adminRevokePartnerKeyAction(keyId, 'revogada pelo admin')
      if (!res.ok) {
        setMsg({ kind: 'err', text: res.error })
        return
      }
      const lista = await adminListPartnerKeysAction(partnerId)
      if (lista.ok) setKeys(lista.data ?? [])
    })
  }

  if (keys === null) {
    return (
      <Button size="sm" variant="ghost" onClick={recarregar} disabled={pendente}>
        {pendente ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <KeyRound className="mr-1 h-3.5 w-3.5" />
        )}
        Credenciais de parceiro
      </Button>
    )
  }

  const ativas = keys.filter((k) => !k.revokedAt)
  const revogadas = keys.filter((k) => k.revokedAt)

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
        Credenciais de API — {partnerName}
      </p>

      {link && (
        <div className="rounded-md border border-[hsl(var(--warning-foreground))] bg-[hsl(var(--warning))] p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold text-[hsl(var(--warning-foreground))]">
            <Link2 className="h-3.5 w-3.5" />
            Link gerado — entregue ao parceiro
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-white/70 px-2 py-1 font-mono text-[11px]">
              {link.url}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(link.url)
                setCopiado(true)
              }}
            >
              <Copy className="mr-1 h-3.5 w-3.5" />
              {copiado ? 'Copiado' : 'Copiar'}
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-[hsl(var(--warning-foreground))]">
            A credencial aparece <strong>uma única vez</strong>, ao abrir o link. Nem esta tela
            consegue vê-la. O link vale até {new Date(link.expiresAt).toLocaleString('pt-BR')}.
          </p>
          <button
            type="button"
            className="mt-2 text-[11px] underline"
            onClick={() => setLink(null)}
          >
            Já entreguei, pode esconder
          </button>
        </div>
      )}

      {ativas.length === 0 ? (
        <p className="text-xs text-slate-400">Nenhuma credencial ativa.</p>
      ) : (
        <ul className="space-y-1">
          {ativas.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0">
                <span className="font-medium text-slate-900">{k.name}</span>{' '}
                <code className="font-mono text-[10px] text-slate-400">clinni_{k.keyPrefix}_…</code>
                <span className="block text-[10px] text-slate-400">
                  {k.scopes.join(', ') || 'sem escopo'}
                  {k.allowedIps && k.allowedIps.length > 0 && ` · IPs: ${k.allowedIps.join(', ')}`}
                  {k.expiresAt && ` · vence ${k.expiresAt.slice(0, 10)}`}
                  {' · '}
                  {k.lastUsedAt ? `último uso ${k.lastUsedAt.slice(0, 10)}` : 'nunca usada'}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0 text-destructive"
                disabled={pendente}
                onClick={() => revogar(k.id)}
              >
                <ShieldOff className="mr-1 h-3 w-3" />
                Revogar
              </Button>
            </li>
          ))}
        </ul>
      )}

      {revogadas.length > 0 && (
        <p className="text-[10px] text-slate-400">
          {revogadas.length} credencial{revogadas.length === 1 ? '' : 'es'} revogada
          {revogadas.length === 1 ? '' : 's'} (mantidas para a trilha de acesso).
        </p>
      )}

      <div className="space-y-2 border-t border-slate-200 pt-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <div>
            <Label className="text-[11px] font-bold uppercase text-slate-500">Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="produção" />
          </div>
          <div>
            <Label className="text-[11px] font-bold uppercase text-slate-500">
              Validade (dias)
            </Label>
            <Input
              value={validadeDias}
              onChange={(e) => setValidadeDias(e.target.value)}
              inputMode="numeric"
              placeholder="365"
            />
            <p className="mt-1 text-[10px] text-slate-400">0 = sem prazo.</p>
          </div>
          <div>
            <Label className="text-[11px] font-bold uppercase text-slate-500">IPs permitidos</Label>
            <Input
              value={faixasIp}
              onChange={(e) => setFaixasIp(e.target.value)}
              placeholder="203.0.113.7, 198.51.100.0/24"
              className="font-mono text-xs"
            />
            <p className="mt-1 text-[10px] text-slate-400">Vazio = qualquer origem.</p>
          </div>
        </div>

        <div className="space-y-1">
          {PARTNER_SCOPES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={scopes.includes(s)}
                onChange={(e) =>
                  setScopes((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))
                }
              />
              <code className="font-mono text-[10px]">{s}</code>
              <span className="text-slate-400">— {SCOPE_LABEL[s]}</span>
            </label>
          ))}
        </div>

        <Button size="sm" onClick={gerar} disabled={pendente || scopes.length === 0}>
          {pendente && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          Gerar credenciais de parceiro
        </Button>
        {msg && (
          <span
            className={`ml-2 text-xs ${msg.kind === 'ok' ? 'text-success-text' : 'text-destructive'}`}
          >
            {msg.text}
          </span>
        )}
      </div>
    </div>
  )
}

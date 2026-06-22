'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Hash, Loader2, Send, User, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChat } from '../../_components/chat-provider'
import type { ChatMessage } from '@/lib/core/chat/crud'

export interface ChatUser {
  id: string
  name: string
}

/** 'geral' (canal) ou o id do outro usuário (DM). */
type ConvKey = string
const GERAL: ConvKey = 'geral'

export function ChatRoom({
  initialMessages,
  users,
  me,
  initialConversation,
}: {
  initialMessages: ChatMessage[]
  users: ChatUser[]
  me: string
  initialConversation: string | null
}) {
  const { subscribe, clearUnread } = useChat()

  const initialConv: ConvKey =
    initialConversation && users.some((u) => u.id === initialConversation)
      ? initialConversation
      : GERAL
  const [active, setActive] = useState<ConvKey>(initialConv)
  const activeRef = useRef<ConvKey>(active)
  activeRef.current = active

  const [messages, setMessages] = useState<ChatMessage[]>(
    initialConv === GERAL ? initialMessages : [],
  )
  const [loading, setLoading] = useState(initialConv !== GERAL)
  const [unreadConvs, setUnreadConvs] = useState<Set<ConvKey>>(new Set())
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [nudging, setNudging] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const userName = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of users) m.set(u.id, u.name)
    return m
  }, [users])

  // Qual conversa uma mensagem pertence (do meu ponto de vista).
  const convOf = useCallback(
    (m: ChatMessage): ConvKey => {
      if (m.toUserId === null) return GERAL
      return m.userId === me ? m.toUserId : m.userId
    },
    [me],
  )

  // Carrega o histórico da conversa ativa.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const withParam = active === GERAL ? 'geral' : active
    void (async () => {
      const res = await fetch(`/api/chat/messages?with=${encodeURIComponent(withParam)}`, {
        cache: 'no-store',
      })
      if (cancelled) return
      if (res.ok) {
        const body = (await res.json()) as { messages: ChatMessage[] }
        setMessages(body.messages)
      }
      setLoading(false)
    })()
    setUnreadConvs((prev) => {
      if (!prev.has(active)) return prev
      const next = new Set(prev)
      next.delete(active)
      return next
    })
    return () => {
      cancelled = true
    }
  }, [active])

  // Recebe mensagens em tempo real (uma conexão no provider global).
  useEffect(
    () =>
      subscribe((m) => {
        const conv = convOf(m)
        if (conv === activeRef.current) {
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
        } else if (m.userId !== me) {
          setUnreadConvs((prev) => {
            const next = new Set(prev)
            next.add(conv)
            return next
          })
        }
      }),
    [subscribe, convOf, me],
  )

  useEffect(() => {
    clearUnread()
  }, [clearUnread, messages.length])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const toUserId = active === GERAL ? null : active

  async function send() {
    const content = text.trim()
    if (content.length < 1 || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'text', content, to_user_id: toUserId }),
      })
      if (res.ok) setText('')
    } finally {
      setSending(false)
    }
  }

  async function nudge() {
    if (nudging) return
    setNudging(true)
    try {
      await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'nudge', to_user_id: toUserId }),
      })
    } finally {
      setNudging(false)
    }
  }

  const activeTitle = active === GERAL ? 'Geral — toda a clínica' : (userName.get(active) ?? 'Conversa')

  return (
    <div className="flex h-[calc(100vh-9rem)] overflow-hidden rounded-xl border border-slate-200 bg-white">
      {/* Lista de conversas */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-slate-50/60 sm:flex">
        <div className="overflow-y-auto p-2">
          <ConvButton
            active={active === GERAL}
            unread={unreadConvs.has(GERAL)}
            onClick={() => setActive(GERAL)}
            icon={<Hash className="h-4 w-4" />}
            label="Geral"
          />
          <p className="px-2 pb-1 pt-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Conversas diretas
          </p>
          {users.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-slate-400">Nenhum outro usuário.</p>
          ) : (
            users.map((u) => (
              <ConvButton
                key={u.id}
                active={active === u.id}
                unread={unreadConvs.has(u.id)}
                onClick={() => setActive(u.id)}
                icon={<User className="h-4 w-4" />}
                label={u.name}
              />
            ))
          )}
        </div>
      </aside>

      {/* Conversa ativa */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700">
          {active === GERAL ? <Hash className="h-4 w-4 text-primary" /> : <User className="h-4 w-4 text-primary" />}
          {activeTitle}
        </div>

        {/* Seletor de conversa no mobile */}
        <div className="border-b border-slate-200 p-2 sm:hidden">
          <select
            value={active}
            onChange={(e) => setActive(e.target.value)}
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
          >
            <option value={GERAL}>Geral — toda a clínica</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {unreadConvs.has(u.id) ? '● ' : ''}
                {u.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {loading ? (
            <p className="py-10 text-center text-sm text-slate-400">Carregando…</p>
          ) : messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">
              {active === GERAL
                ? 'Nenhuma mensagem ainda. Diga oi para a equipe 👋'
                : 'Nenhuma mensagem nesta conversa ainda.'}
            </p>
          ) : (
            messages.map((m) =>
              m.kind === 'nudge' ? (
                <div key={m.id} className="flex justify-center py-1">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold text-amber-700">
                    <Zap className="h-3 w-3" /> {m.userId === me ? 'Você' : m.fromName} chamou a atenção
                  </span>
                </div>
              ) : (
                <div key={m.id} className={`flex ${m.userId === me ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                      m.userId === me
                        ? 'rounded-br-sm bg-primary text-white'
                        : 'rounded-bl-sm bg-slate-100 text-slate-800'
                    }`}
                  >
                    {m.userId !== me ? (
                      <p className="mb-0.5 text-[11px] font-bold text-slate-500">{m.fromName}</p>
                    ) : null}
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                    <p
                      className={`mt-0.5 text-right text-[10px] ${
                        m.userId === me ? 'text-white/70' : 'text-slate-400'
                      }`}
                    >
                      {formatTime(m.createdAt)}
                    </p>
                  </div>
                </div>
              ),
            )
          )}
          <div ref={bottomRef} />
        </div>

        <div className="flex items-end gap-2 border-t border-slate-200 bg-slate-50 p-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void nudge()}
            disabled={nudging}
            title={
              active === GERAL
                ? 'Chamar atenção — sacode a tela de todos'
                : 'Chamar atenção desta pessoa'
            }
            className="shrink-0 border-amber-300 text-amber-600 hover:bg-amber-50"
          >
            {nudging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          </Button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder={active === GERAL ? 'Mensagem para a equipe…' : `Mensagem para ${activeTitle}…`}
            className="max-h-32 flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10"
          />
          <Button
            type="button"
            onClick={() => void send()}
            disabled={sending || text.trim().length < 1}
            className="shrink-0 gap-2"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar
          </Button>
        </div>
      </div>
    </div>
  )
}

function ConvButton({
  active,
  unread,
  onClick,
  icon,
  label,
}: {
  active: boolean
  unread: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
        active ? 'bg-primary/10 font-semibold text-primary' : 'text-slate-700 hover:bg-slate-100'
      }`}
    >
      <span className={active ? 'text-primary' : 'text-slate-400'}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {unread ? <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" /> : null}
    </button>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

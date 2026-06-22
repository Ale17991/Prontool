'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Send, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChat } from '../../_components/chat-provider'
import type { ChatMessage } from '@/lib/core/chat/crud'

export function ChatRoom({
  initialMessages,
  me,
}: {
  initialMessages: ChatMessage[]
  me: string
}) {
  const { subscribe, clearUnread } = useChat()
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [nudging, setNudging] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const append = useCallback((m: ChatMessage) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
  }, [])

  // Recebe mensagens em tempo real via o provider global (uma única conexão).
  useEffect(() => subscribe(append), [subscribe, append])

  // Estamos na página do chat → zera o não-lido.
  useEffect(() => {
    clearUnread()
  }, [clearUnread, messages.length])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function send() {
    const content = text.trim()
    if (content.length < 1 || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'text', content }),
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
        body: JSON.stringify({ kind: 'nudge' }),
      })
    } finally {
      setNudging(false)
    }
  }

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            Nenhuma mensagem ainda. Diga oi para a equipe 👋
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
          title="Chamar atenção — sacode a tela de todos"
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
          placeholder="Escreva uma mensagem para a equipe…"
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
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

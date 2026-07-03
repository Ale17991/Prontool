'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { MessageCircle, X, Zap } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser'
import type { ChatMessage } from '@/lib/core/chat/crud'

const CHAT_PATH = '/operacao/chat'

interface ChatContextValue {
  unread: number
  clearUnread: () => void
  /** Registra um ouvinte de mensagens novas (realtime). Retorna unsubscribe. */
  subscribe: (cb: (m: ChatMessage) => void) => () => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat deve ser usado dentro de <ChatProvider>')
  return ctx
}

/** Toca um bipe curto (best-effort; bloqueado até a 1ª interação em alguns navegadores). */
function playBeep(strong: boolean) {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ac = new Ctx()
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.connect(gain)
    gain.connect(ac.destination)
    osc.type = strong ? 'sawtooth' : 'sine'
    osc.frequency.value = strong ? 880 : 660
    gain.gain.setValueAtTime(0.001, ac.currentTime)
    gain.gain.exponentialRampToValueAtTime(strong ? 0.25 : 0.12, ac.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + (strong ? 0.5 : 0.25))
    osc.start()
    osc.stop(ac.currentTime + (strong ? 0.55 : 0.3))
    if (strong) {
      // segundo bipe pra reforçar o "chamar atenção"
      const osc2 = ac.createOscillator()
      const g2 = ac.createGain()
      osc2.connect(g2)
      g2.connect(ac.destination)
      osc2.type = 'sawtooth'
      osc2.frequency.value = 1040
      g2.gain.setValueAtTime(0.001, ac.currentTime + 0.18)
      g2.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + 0.2)
      g2.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.7)
      osc2.start(ac.currentTime + 0.18)
      osc2.stop(ac.currentTime + 0.75)
    }
  } catch {
    /* sem som não é erro */
  }
}

function shakeScreen() {
  if (typeof document === 'undefined') return
  const el = document.body
  el.classList.remove('chat-shake')
  // força reflow pra reiniciar a animação se já estava aplicada
  void el.offsetWidth
  el.classList.add('chat-shake')
  window.setTimeout(() => el.classList.remove('chat-shake'), 700)
}

interface Popup {
  id: string
  fromName: string
  content: string
  nudge: boolean
  /** Se for DM, id do remetente para abrir a conversa direto. */
  dmFrom: string | null
}

export function ChatProvider({
  userId,
  tenantId,
  children,
}: {
  userId: string
  tenantId: string
  children: ReactNode
}) {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const onChatPage = pathname.startsWith(CHAT_PATH)
  const onChatPageRef = useRef(onChatPage)
  onChatPageRef.current = onChatPage

  const [unread, setUnread] = useState(0)
  const [popup, setPopup] = useState<Popup | null>(null)
  const popupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listeners = useRef<Set<(m: ChatMessage) => void>>(new Set())

  const clearUnread = useCallback(() => setUnread(0), [])

  const subscribe = useCallback((cb: (m: ChatMessage) => void) => {
    listeners.current.add(cb)
    return () => {
      listeners.current.delete(cb)
    }
  }, [])

  // Zera o contador ao entrar na página do chat.
  useEffect(() => {
    if (onChatPage) setUnread(0)
  }, [onChatPage])

  useEffect(() => {
    let supabase: ReturnType<typeof createSupabaseBrowserClient>
    try {
      supabase = createSupabaseBrowserClient()
    } catch {
      // Sem cliente de realtime o chat fica indisponível, mas o dashboard segue.
      return
    }
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false

    void (async () => {
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      if (data.session) supabase.realtime.setAuth(data.session.access_token)

      channel = supabase
        .channel(`chat-popup:${tenantId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
            filter: `tenant_id=eq.${tenantId}`,
          },
          (payload) => {
            const r = payload.new as Record<string, unknown>
            const msg: ChatMessage = {
              id: r.id as string,
              userId: r.user_id as string,
              fromName: (r.from_name as string) ?? '',
              toUserId: (r.to_user_id as string | null) ?? null,
              kind: (r.kind as 'text' | 'nudge') ?? 'text',
              content: (r.content as string) ?? '',
              createdAt: r.created_at as string,
            }
            // DM que não me envolve não interessa (a RLS já filtraria; guard extra).
            if (msg.toUserId !== null && msg.toUserId !== userId && msg.userId !== userId) return

            // Entrega a quem estiver ouvindo (ex.: a sala de chat aberta).
            listeners.current.forEach((cb) => cb(msg))

            // Mensagem própria não interrompe nem conta.
            if (msg.userId === userId) return

            if (msg.kind === 'nudge') {
              // "Chamar atenção" — sacode a tela em qualquer lugar.
              shakeScreen()
              playBeep(true)
            } else {
              playBeep(false)
            }

            if (!onChatPageRef.current) {
              const isDm = msg.toUserId !== null
              const prefix =
                msg.kind === 'nudge'
                  ? `${msg.fromName} chamou sua atenção!`
                  : isDm
                    ? `${msg.fromName} (privado): ${msg.content}`
                    : msg.content
              setUnread((n) => n + 1)
              setPopup({
                id: msg.id,
                fromName: msg.fromName,
                content: prefix,
                nudge: msg.kind === 'nudge',
                dmFrom: isDm ? msg.userId : null,
              })
              if (popupTimer.current) clearTimeout(popupTimer.current)
              popupTimer.current = setTimeout(() => setPopup(null), 9000)
            }
          },
        )
        .subscribe()
    })()

    return () => {
      cancelled = true
      if (popupTimer.current) clearTimeout(popupTimer.current)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [tenantId, userId])

  function openChat(dmFrom?: string | null) {
    setPopup(null)
    router.push(dmFrom ? `${CHAT_PATH}?c=${dmFrom}` : CHAT_PATH)
  }

  return (
    <ChatContext.Provider value={{ unread, clearUnread, subscribe }}>
      {children}
      {popup ? (
        <div className="fixed bottom-5 right-5 z-[100] w-80 max-w-[calc(100vw-2.5rem)] animate-in slide-in-from-bottom-4">
          <div
            className={`overflow-hidden rounded-xl border shadow-2xl ${
              popup.nudge ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'
            }`}
          >
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                {popup.nudge ? (
                  <Zap className="h-4 w-4 text-amber-500" />
                ) : (
                  <MessageCircle className="h-4 w-4 text-primary" />
                )}
                {popup.fromName}
              </div>
              <button
                type="button"
                onClick={() => setPopup(null)}
                className="text-slate-400 hover:text-slate-600"
                aria-label="Dispensar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => openChat(popup.dmFrom)}
              className="block w-full px-3 pb-3 text-left text-sm text-slate-700 hover:text-slate-900"
            >
              <span className="line-clamp-2">{popup.content}</span>
              <span className="mt-1 block text-[11px] font-semibold text-link">Responder →</span>
            </button>
          </div>
        </div>
      ) : null}
    </ChatContext.Provider>
  )
}

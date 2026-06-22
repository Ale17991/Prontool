import { redirect } from 'next/navigation'
import { MessageCircle } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listChatMessages } from '@/lib/core/chat/crud'
import { ChatRoom } from './chat-room'

export const dynamic = 'force-dynamic'

export default async function ChatPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServiceClient()
  const messages = await listChatMessages(supabase, { tenantId: session.tenantId }).catch(() => [])

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <MessageCircle className="h-6 w-6 text-primary" />
          Chat da equipe
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Canal interno da clínica. Use o raio (Chamar atenção) para um alerta forte que sacode a
          tela de quem estiver online.
        </p>
      </div>
      <ChatRoom initialMessages={messages} me={session.userId} />
    </div>
  )
}

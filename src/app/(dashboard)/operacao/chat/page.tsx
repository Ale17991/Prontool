import { redirect } from 'next/navigation'
import { MessageCircle } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listChatMessages } from '@/lib/core/chat/crud'
import { listTeamMembers } from '@/lib/core/team/list'
import { ChatRoom, type ChatUser } from './chat-room'

export const dynamic = 'force-dynamic'

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServiceClient()
  const [initialMessages, members] = await Promise.all([
    listChatMessages(supabase, {
      tenantId: session.tenantId,
      conversation: { kind: 'channel' },
    }).catch(() => []),
    listTeamMembers(supabase, { tenantId: session.tenantId, requesterId: session.userId }).catch(
      () => [],
    ),
  ])
  const users: ChatUser[] = members
    .filter((m) => m.status === 'active' && !m.isSelf)
    .map((m) => ({
      id: m.userId,
      name: m.fullName || m.email,
      avatarUrl: m.avatar?.signedUrl ?? null,
    }))

  const cParam = typeof searchParams.c === 'string' ? searchParams.c : null

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <MessageCircle className="h-6 w-6 text-primary" />
          Chat da equipe
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Canal geral da clínica + conversas diretas 1:1. Use o raio (Chamar atenção) para um alerta
          forte que sacode a tela de quem estiver online.
        </p>
      </div>
      <ChatRoom
        initialMessages={initialMessages}
        users={users}
        me={session.userId}
        initialConversation={cParam}
      />
    </div>
  )
}

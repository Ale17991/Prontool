import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'

export type ChatKind = 'text' | 'nudge'

export interface ChatMessage {
  id: string
  userId: string
  fromName: string
  kind: ChatKind
  content: string
  createdAt: string
}

const SELECT = 'id, user_id, from_name, kind, content, created_at'

function toDto(r: Record<string, unknown>): ChatMessage {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    fromName: (r.from_name as string) ?? '',
    kind: (r.kind as ChatKind) ?? 'text',
    content: (r.content as string) ?? '',
    createdAt: r.created_at as string,
  }
}

/** Últimas mensagens do canal do tenant, em ordem cronológica (asc). */
export async function listChatMessages(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; limit?: number },
): Promise<ChatMessage[]> {
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 200)
  const { data, error } = await supabase
    .from('chat_messages' as never)
    .select(SELECT)
    .eq('tenant_id', args.tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listChatMessages failed: ${error.message}`)
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(toDto).reverse()
}

export interface PostChatMessageInput {
  tenantId: string
  userId: string
  fromName: string
  kind: ChatKind
  /** Para nudge o conteúdo é opcional; usamos um rótulo padrão. */
  content?: string
}

export async function postChatMessage(
  supabase: SupabaseClient<Database>,
  input: PostChatMessageInput,
): Promise<ChatMessage> {
  const kind: ChatKind = input.kind === 'nudge' ? 'nudge' : 'text'
  const content =
    kind === 'nudge'
      ? (input.content?.trim() || 'chamou a atenção 👋')
      : (input.content ?? '').trim()
  if (kind === 'text' && content.length < 1) throw new ValidationError('Mensagem vazia.')
  if (content.length > 4000) throw new ValidationError('Mensagem muito longa.')

  const { data, error } = await supabase
    .from('chat_messages' as never)
    .insert({
      tenant_id: input.tenantId,
      user_id: input.userId,
      from_name: input.fromName || 'Usuário',
      kind,
      content,
    } as never)
    .select(SELECT)
    .single()
  if (error) throw new Error(`postChatMessage failed: ${error.message}`)
  return toDto(data as unknown as Record<string, unknown>)
}

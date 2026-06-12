import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { DomainEvent, DispatchResult } from '@/lib/integrations/types'
import { dispatchDomainEvent } from './dispatch'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { syncDomainEventToGoogle } from '@/lib/core/integrations/google-calendar/sync'

/**
 * Thin wrapper around the dispatcher. Kept as a separate file so route
 * handlers and core services import a stable "publish" name even if the
 * dispatch implementation evolves (sync → async via QStash, etc.).
 *
 * Além do fan-out por-tenant (adapters), dispara o sync POR-USUÁRIO do Google
 * Calendar (agenda do profissional do atendimento). Best-effort, com service
 * client próprio (as tabelas user_integrations/appointment_calendar_sync são
 * service-only) e nunca derruba a publicação.
 */
export async function publishDomainEvent(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  event: DomainEvent,
): Promise<DispatchResult[]> {
  const results = await dispatchDomainEvent(supabase, tenantId, event)
  await syncDomainEventToGoogle(createSupabaseServiceClient(), event)
  return results
}

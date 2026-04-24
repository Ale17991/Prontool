import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { DomainEvent, DispatchResult } from '@/lib/integrations/types'
import { dispatchDomainEvent } from './dispatch'

/**
 * Thin wrapper around the dispatcher. Kept as a separate file so route
 * handlers and core services import a stable "publish" name even if the
 * dispatch implementation evolves (sync → async via QStash, etc.).
 */
export async function publishDomainEvent(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  event: DomainEvent,
): Promise<DispatchResult[]> {
  return dispatchDomainEvent(supabase, tenantId, event)
}

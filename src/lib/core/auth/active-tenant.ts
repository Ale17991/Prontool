import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Feature 010 (US3) — leitura/escrita da "última clínica usada" por usuário.
 *
 * Read pode ser feito com qualquer client autenticado (RLS self-read).
 * Write exige service-role: a tabela não tem policy de INSERT/UPDATE para
 * `authenticated`, então só RPC SECURITY DEFINER ou service-role consegue.
 * O caller deve passar um service-role client em `setActiveTenant`.
 */

export async function getActiveTenantId(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('user_active_tenant')
    .select('tenant_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error && error.code !== 'PGRST116') {
    throw new Error(`getActiveTenantId failed: ${error.message}`)
  }
  return data?.tenant_id ?? null
}

export async function setActiveTenant(
  supabaseService: SupabaseClient<Database>,
  userId: string,
  tenantId: string,
): Promise<void> {
  const { error } = await supabaseService
    .from('user_active_tenant')
    .upsert(
      { user_id: userId, tenant_id: tenantId, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
  if (error) {
    throw new Error(`setActiveTenant upsert failed: ${error.message}`)
  }
}

import { createBrowserClient } from '@supabase/ssr'
import type { Database } from './generated/types'

/**
 * Browser client. Only use in Client Components. Respects RLS.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing')
  }
  return createBrowserClient<Database>(url, anon)
}

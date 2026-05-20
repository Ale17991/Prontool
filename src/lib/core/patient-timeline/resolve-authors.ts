import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { AuthorMap } from './types'

interface KnownDoctor {
  user_id: string | null
  full_name: string
}

interface ResolveArgs {
  tenantId: string
  userIds: ReadonlySet<string>
  knownDoctors?: ReadonlyArray<KnownDoctor>
}

interface DoctorRow {
  user_id: string | null
  full_name: string
}

interface UserProfileRow {
  user_id: string
  full_name: string | null
}

export async function resolveAuthors(
  supabase: SupabaseClient<Database>,
  args: ResolveArgs,
): Promise<AuthorMap> {
  const result = new Map<string, string>()

  for (const d of args.knownDoctors ?? []) {
    if (d.user_id && args.userIds.has(d.user_id)) {
      result.set(d.user_id, d.full_name)
    }
  }

  const stillMissing = (): string[] =>
    Array.from(args.userIds).filter((u) => !result.has(u))

  let remaining = stillMissing()
  if (remaining.length === 0) return result

  const doctorsRes = await supabase
    .from('doctors')
    .select('user_id, full_name')
    .eq('tenant_id', args.tenantId)
    .in('user_id', remaining)
    .not('user_id', 'is', null)
  if (!doctorsRes.error && doctorsRes.data) {
    for (const r of doctorsRes.data as unknown as DoctorRow[]) {
      if (r.user_id) result.set(r.user_id, r.full_name)
    }
  }

  remaining = stillMissing()
  if (remaining.length === 0) return result

  // user_profile é per-user (não per-tenant); RLS controla acesso. Não
  // filtramos por tenant_id porque a coluna não existe nessa tabela.
  const profileRes = await supabase
    .from('user_profile')
    .select('user_id, full_name')
    .in('user_id', remaining)
  if (!profileRes.error && profileRes.data) {
    for (const r of profileRes.data as unknown as UserProfileRow[]) {
      if (r.full_name && r.full_name.trim().length > 0) {
        result.set(r.user_id, r.full_name)
      }
    }
  }

  return result
}

export function formatAuthorDisplay(
  authors: AuthorMap,
  userId: string,
): string {
  const name = authors.get(userId)
  if (name) return name
  return userId.slice(0, 8)
}

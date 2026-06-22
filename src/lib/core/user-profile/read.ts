import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { createSignedUrlOrNull } from '@/lib/core/storage/signed-url'
import {
  USER_AVATAR_BUCKET,
  USER_AVATAR_SIGNED_URL_TTL_SECONDS,
  type UserProfile,
} from './types'

type Row = Database['public']['Tables']['user_profile']['Row']

function syntheticEmpty(userId: string): Row {
  const now = new Date().toISOString()
  return {
    user_id: userId,
    full_name: null,
    avatar_path: null,
    avatar_uploaded_at: null,
    phone: null,
    timezone: 'America/Sao_Paulo',
    created_at: now,
    updated_at: now,
  }
}

function rowToProfile(row: Row, email: string | null, signedAvatarUrl: string | null): UserProfile {
  return {
    userId: row.user_id,
    email,
    fullName: row.full_name,
    avatar: row.avatar_path
      ? {
          path: row.avatar_path,
          signedUrl: signedAvatarUrl,
          uploadedAt: row.avatar_uploaded_at ?? row.updated_at,
        }
      : null,
    timezone: row.timezone,
    updatedAt: row.updated_at,
  }
}

/**
 * Lê o perfil do usuário. Cria a row vazia (lazy) se não existir — RLS
 * permite self-insert. Devolve uma row sintética se o INSERT falhar
 * (ambiente sem permissão para escrever) para que o caller renderize o
 * fallback gracioso.
 */
export async function getUserProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
  email: string | null,
  signedUrlTtl: number = USER_AVATAR_SIGNED_URL_TTL_SECONDS,
): Promise<UserProfile> {
  const { data: existing, error: selectError } = await supabase
    .from('user_profile')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (selectError) throw new Error(`getUserProfile select failed: ${selectError.message}`)

  let row = existing as Row | null
  if (!row) {
    const { data: inserted, error: insertError } = await supabase
      .from('user_profile')
      .insert({ user_id: userId })
      .select('*')
      .maybeSingle()

    if (insertError) {
      const { data: reread } = await supabase
        .from('user_profile')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle()
      row = (reread as Row | null) ?? syntheticEmpty(userId)
    } else {
      row = inserted as Row
    }
  }

  const signedAvatarUrl = await createSignedUrlOrNull(
    supabase,
    USER_AVATAR_BUCKET,
    row.avatar_path,
    signedUrlTtl,
  )
  return rowToProfile(row, email, signedAvatarUrl)
}

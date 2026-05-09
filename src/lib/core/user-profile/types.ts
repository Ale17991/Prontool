/**
 * Types compartilhados entre read/update/avatar/senha e UI.
 */

export interface UserProfileAvatar {
  path: string
  signedUrl: string | null
  uploadedAt: string
}

export interface UserProfile {
  userId: string
  email: string | null
  fullName: string | null
  avatar: UserProfileAvatar | null
  timezone: string
  updatedAt: string
}

export const USER_AVATAR_BUCKET = 'user-avatars' as const
export const USER_AVATAR_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 // 24 h
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024 // 2 MB

export const PASSWORD_MIN_LENGTH = 8

export interface PasswordPolicyFailure {
  reason: 'too_short' | 'missing_letter' | 'missing_digit'
}

export function validatePasswordStrength(pw: string): PasswordPolicyFailure | null {
  if (pw.length < PASSWORD_MIN_LENGTH) return { reason: 'too_short' }
  if (!/[A-Za-z]/.test(pw)) return { reason: 'missing_letter' }
  if (!/[0-9]/.test(pw)) return { reason: 'missing_digit' }
  return null
}

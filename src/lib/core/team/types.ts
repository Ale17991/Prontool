import type { TenantRole } from '@/lib/db/types'

export type TeamMemberStatus = 'active' | 'pending' | 'disabled'

export interface TeamMemberAvatar {
  path: string
  signedUrl: string | null
}

export interface TeamMember {
  userId: string
  email: string
  fullName: string | null
  phone: string | null
  avatar: TeamMemberAvatar | null
  role: TenantRole
  status: TeamMemberStatus
  lastSignInAt: string | null
  isSelf: boolean
  /** Feature 012 — profissional vinculado (doctors.user_id). */
  linkedDoctor: { id: string; fullName: string } | null
}

export const TENANT_ROLES_ORDERED: readonly TenantRole[] = [
  'admin',
  'financeiro',
  'recepcionista',
  'profissional_saude',
] as const

export function labelForRole(role: TenantRole): string {
  switch (role) {
    case 'admin':
      return 'Administrador'
    case 'financeiro':
      return 'Financeiro'
    case 'recepcionista':
      return 'Recepcionista'
    case 'profissional_saude':
      return 'Profissional de Saúde'
  }
}

export function labelForStatus(status: TeamMemberStatus): string {
  switch (status) {
    case 'active':
      return 'Ativo'
    case 'pending':
      return 'Convite pendente'
    case 'disabled':
      return 'Desativado'
  }
}

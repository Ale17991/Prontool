import type { TenantRole } from '@/lib/db/types'

export const ROLES = {
  admin: 'admin',
  financeiro: 'financeiro',
  recepcionista: 'recepcionista',
  profissional_saude: 'profissional_saude',
} as const satisfies Record<TenantRole, TenantRole>

type Action =
  | 'price.write'
  | 'price.read'
  | 'procedure.write'
  | 'procedure.read'
  | 'plan.write'
  | 'plan.read'
  | 'doctor.write'
  | 'doctor.read'
  | 'commission.write'
  | 'appointment.read'
  | 'appointment.reverse'
  | 'report.read'
  | 'report.export'
  | 'audit.read'
  | 'audit.export'
  | 'alert.read'
  | 'alert.resolve'
  | 'dlq.read'
  | 'dlq.reprocess'
  | 'expense.read'
  | 'expense.write'
  | 'anamnesis.read'
  | 'anamnesis.write'
  | 'tax.read'
  | 'tax.write'
  | 'task.read'
  | 'task.write'

const MATRIX: Record<TenantRole, readonly Action[]> = {
  admin: [
    'price.write', 'price.read',
    'procedure.write', 'procedure.read',
    'plan.write', 'plan.read',
    'doctor.write', 'doctor.read',
    'commission.write',
    'appointment.read', 'appointment.reverse',
    'report.read', 'report.export',
    'audit.read', 'audit.export',
    'alert.read', 'alert.resolve',
    'dlq.read', 'dlq.reprocess',
    'expense.read', 'expense.write',
    'anamnesis.read', 'anamnesis.write',
    'tax.read', 'tax.write',
    'task.read', 'task.write',
  ],
  financeiro: [
    'price.read',
    'procedure.read',
    'plan.read',
    'doctor.read',
    'appointment.read', 'appointment.reverse',
    'report.read', 'report.export',
    'alert.read',
    'dlq.read',
    'expense.read', 'expense.write',
    'anamnesis.read',
    'tax.read', 'tax.write',
    'task.read', 'task.write',
  ],
  recepcionista: [
    'price.read',
    'procedure.read',
    'plan.read',
    'doctor.read',
    'appointment.read',
    'anamnesis.read',
    'tax.read',
    'task.read', 'task.write',
  ],
  profissional_saude: [
    'appointment.read',
    'anamnesis.read',
    'tax.read',
    'task.read', 'task.write',
  ],
}

export function can(role: TenantRole | null | undefined, action: Action): boolean {
  if (!role) return false
  return MATRIX[role].includes(action)
}

export type { Action }

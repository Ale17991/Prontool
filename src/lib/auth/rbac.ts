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
  | 'doctor.payment_mode.write'
  | 'doctor.payment_terms.read'
  | 'commission.write'
  | 'appointment.read'
  | 'appointment.reverse'
  | 'appointment.assistant.write'
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
  | 'public_booking.config'
  | 'patient_portal.config'
  | 'reminders.config'
  // Ver VALORES monetários em telas de leitura/agregação (ficha financeira do
  // paciente, somatórios, etc.). Recepção NÃO tem — ela só vê/digita o valor no
  // ato do registro (form de atendimento/pagamento), nunca em relatórios.
  | 'finance.view_values'

const MATRIX: Record<TenantRole, readonly Action[]> = {
  admin: [
    'price.write',
    'price.read',
    'procedure.write',
    'procedure.read',
    'plan.write',
    'plan.read',
    'doctor.write',
    'doctor.read',
    'doctor.payment_mode.write',
    'doctor.payment_terms.read',
    'commission.write',
    'appointment.read',
    'appointment.reverse',
    'appointment.assistant.write',
    'report.read',
    'report.export',
    'audit.read',
    'audit.export',
    'alert.read',
    'alert.resolve',
    'dlq.read',
    'dlq.reprocess',
    'expense.read',
    'expense.write',
    'anamnesis.read',
    'anamnesis.write',
    'tax.read',
    'tax.write',
    'task.read',
    'task.write',
    'public_booking.config',
    'patient_portal.config',
    'reminders.config',
    'finance.view_values',
  ],
  financeiro: [
    'price.read',
    'procedure.read',
    'plan.read',
    'doctor.read',
    'doctor.payment_terms.read',
    'appointment.read',
    'appointment.reverse',
    'report.read',
    'report.export',
    'alert.read',
    'dlq.read',
    'expense.read',
    'expense.write',
    'anamnesis.read',
    'tax.read',
    'tax.write',
    'task.read',
    'task.write',
    'finance.view_values',
  ],
  recepcionista: [
    'price.read',
    'procedure.read',
    'plan.read',
    'doctor.read',
    'appointment.read',
    'appointment.assistant.write',
    'anamnesis.read',
    'tax.read',
    'task.read',
    'task.write',
    'public_booking.config',
    'reminders.config',
  ],
  profissional_saude: [
    'appointment.read',
    'anamnesis.read',
    'tax.read',
    'task.read',
    'task.write',
    'finance.view_values',
  ],
}

export function can(role: TenantRole | null | undefined, action: Action): boolean {
  if (!role) return false
  return MATRIX[role].includes(action)
}

// ---------------------------------------------------------------------------
// Feature 043 — overrides de permissão por usuário (grant/deny sobre o papel).
// ---------------------------------------------------------------------------

export type OverrideEffect = 'grant' | 'deny'
export interface PermissionOverride {
  action: Action
  effect: OverrideEffect
}

/**
 * Ações financeiras-críticas protegidas pelo Princípio V da constituição —
 * NÃO são overridáveis: a UI não as oferece e a aplicação rejeita override
 * sobre elas. `canUser` ignora qualquer override nessas ações (papel decide).
 */
export const PROTECTED_ACTIONS: readonly Action[] = [
  'price.write',
  'commission.write',
  'appointment.reverse',
  'audit.read',
  'audit.export',
]

/**
 * Ações sensíveis (overridáveis, mas a UI deve exibir AVISO ao conceder).
 * Lista de escritas/config não-críticas. Não é mecanismo de segurança — só
 * dirige o aviso na interface.
 */
export const SENSITIVE_ACTIONS: readonly Action[] = [
  'procedure.write',
  'plan.write',
  'doctor.write',
  'doctor.payment_mode.write',
  'expense.write',
  'tax.write',
  'anamnesis.write',
  'dlq.reprocess',
  'alert.resolve',
  'report.export',
]

/** Catálogo completo de Actions (admin tem todas — é o superconjunto). */
export const ALL_ACTIONS: readonly Action[] = Array.from(
  new Set(Object.values(MATRIX).flat()),
) as Action[]

/** Uma ação pode receber override? (protegidas não). */
export function isOverridable(action: Action): boolean {
  return !PROTECTED_ACTIONS.includes(action)
}

/**
 * Permissão efetiva = (ações do papel) ∪ grants ∖ denies, com **deny vencendo**.
 * Ações protegidas ignoram overrides (o papel decide). Sem overrides, equivale
 * a `can(role, action)`. Esta é a checagem que a camada autoritativa do servidor
 * deve usar quando overrides são considerados.
 */
export function canUser(
  role: TenantRole | null | undefined,
  overrides: readonly PermissionOverride[],
  action: Action,
): boolean {
  if (!role) return false
  const base = MATRIX[role].includes(action)
  // Protegidas: overrides não se aplicam — o papel decide.
  if (PROTECTED_ACTIONS.includes(action)) return base
  // deny prevalece sobre papel e sobre grant.
  if (overrides.some((o) => o.action === action && o.effect === 'deny')) return false
  if (base) return true
  return overrides.some((o) => o.action === action && o.effect === 'grant')
}

export type { Action }

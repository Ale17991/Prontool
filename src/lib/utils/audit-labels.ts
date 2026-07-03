/**
 * Mapeamento de event_type tecnico (audit_log / DomainEvent) para
 * rotulo amigavel exibido ao usuario final. Feature 007 (US2 — Linguagem
 * simples).
 *
 * O banco e a API mantem os codigos tecnicos (ex: 'appointment.reversed')
 * inalterados — apenas a camada de apresentacao traduz. Isso preserva
 * integridade e auditabilidade (Principios I e II) enquanto evita expor
 * jargao tecnico ao usuario nao-desenvolvedor.
 */
const EVENT_LABELS: Record<string, string> = {
  // appointments
  'appointment.created': 'Atendimento criado',
  'appointment.reversed': 'Cancelamento de atendimento',
  'appointment.realized': 'Atendimento confirmado',
  'appointment_completion.created': 'Atendimento confirmado',
  // materials (feature 007)
  'appointment_material.created': 'Material adicionado ao atendimento',
  // patients
  'patient.created': 'Paciente cadastrado',
  'patient.updated': 'Paciente atualizado',
  'patient.anonymized': 'Paciente anonimizado',
  // pricing / commissions
  'price_versions.amount_cents': 'Preço atualizado',
  'doctor_commission_history.percentage_bps': 'Comissão atualizada',
  // integrations
  'integration.connect': 'Integração conectada',
  'integration.reconfigure': 'Integração reconfigurada',
  'integration.disconnect': 'Integração desconectada',
  integration_sync_failed: 'Falha de sincronização de integração',
  // expenses / receipts
  'expense.created': 'Despesa registrada',
  'expense.deleted': 'Despesa removida',
  'expense_receipt.created': 'Comprovante adicionado',
  'expense_receipt.deleted': 'Comprovante removido',
  // payments
  'payment.created': 'Pagamento registrado',
}

/**
 * Devolve um rotulo amigavel para o `event_type` informado. Se o tipo nao
 * estiver mapeado, devolve a propria string (fallback) — garante que a
 * UI nunca quebra mesmo com eventos novos ainda nao traduzidos.
 */
export function eventTypeToLabel(eventType: string | null | undefined): string {
  if (!eventType) return '—'
  return EVENT_LABELS[eventType] ?? eventType
}

/**
 * Mesma logica para `entity` do audit_log (nome de tabela). Usado em
 * relatorios e telas de auditoria onde a coluna entidade e exibida.
 */
const ENTITY_LABELS: Record<string, string> = {
  appointments: 'Atendimento',
  appointment_reversals: 'Cancelamento de atendimento',
  appointment_completions: 'Confirmação de atendimento',
  appointment_materials: 'Material do atendimento',
  patients: 'Paciente',
  doctors: 'Profissional',
  procedures: 'Procedimento',
  health_plans: 'Plano de saúde',
  price_versions: 'Versão de preço',
  doctor_commission_history: 'Histórico de comissão',
  expenses: 'Despesa',
  expense_receipts: 'Comprovante de despesa',
  payments: 'Pagamento',
  treatment_plan_steps: 'Etapa de plano de tratamento',
  tenant_integrations: 'Integração',
  alerts: 'Alerta',
}

export function entityToLabel(entity: string | null | undefined): string {
  if (!entity) return '—'
  return ENTITY_LABELS[entity] ?? entity
}

/**
 * Mensagem generica padrao para erros nao classificados na UI.
 * Centralizado aqui para reuso em error.tsx, toasts, etc.
 */
export const GENERIC_ERROR_MESSAGE = 'Algo deu errado. Tente novamente em alguns segundos.'

import { z } from 'zod'

export const SUPPORT_TICKET_KINDS = ['bug', 'suggestion', 'support'] as const
export type SupportTicketKind = (typeof SUPPORT_TICKET_KINDS)[number]

export const SupportTicketCreateSchema = z.object({
  kind: z.enum(SUPPORT_TICKET_KINDS),
  title: z.string().min(3).max(120),
  description: z.string().min(10).max(5000),
  pageUrl: z.string().max(500).nullable().optional(),
})

export type SupportTicketCreateInput = z.infer<typeof SupportTicketCreateSchema>

export const KIND_LABELS: Record<SupportTicketKind, string> = {
  bug: 'Bug / Erro',
  suggestion: 'Sugestão',
  support: 'Suporte',
}

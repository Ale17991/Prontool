import { z } from 'zod'

/** Tokens OAuth do Google (cifrados em user_integrations.credentials_enc). */
export const googleOAuthCredentialsSchema = z.object({
  access_token: z.string(),
  /** O refresh_token só vem no primeiro consentimento (access_type=offline + prompt=consent). */
  refresh_token: z.string(),
  /** ISO — quando o access_token expira. */
  expires_at: z.string(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
})
export type GoogleOAuthCredentials = z.infer<typeof googleOAuthCredentialsSchema>

/** Config não-sensível (calendário alvo + e-mail conectado, para a UI). */
export const googleCalendarConfigSchema = z.object({
  /** Calendário onde os eventos são criados. 'primary' = agenda principal. */
  calendar_id: z.string().default('primary'),
  /** E-mail da conta Google conectada (exibido na UI). */
  account_email: z.string().optional(),
})
export type GoogleCalendarConfig = z.infer<typeof googleCalendarConfigSchema>

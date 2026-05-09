import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { ConflictError, ValidationError } from '@/lib/observability/errors'

/**
 * Feature 010 (US2) — Cadastro próprio (R8 + R14).
 *
 * Server-side wrapper sobre `auth.admin.createUser`. Razões para não chamar
 * `supabase.auth.signUp` direto do client:
 *   - Audit log: precisamos registrar a criação, mesmo sem tenant ainda.
 *   - Anti-enumeration: erros de duplicidade viram mensagem genérica
 *     `SIGNUP_FAILED` (FR-011).
 *   - Política de senha: validação Zod centralizada.
 *
 * `email_confirm: false` permite acesso imediato — verificação de e-mail
 * vira recuperação de senha futura (FR-012).
 */

export const signupSchema = z.object({
  fullName: z.string().trim().min(1, 'Nome é obrigatório').max(200),
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(320),
  password: z
    .string()
    .min(8, 'Senha precisa de pelo menos 8 caracteres')
    .max(200)
    .regex(/[a-zA-Z]/, 'Senha precisa conter ao menos uma letra')
    .regex(/[0-9]/, 'Senha precisa conter ao menos um dígito'),
})

export type SignupInput = z.infer<typeof signupSchema>

export interface SignupResult {
  userId: string
}

interface SignupContext {
  ip?: string | null
  userAgent?: string | null
}

const GENERIC_FAILURE = 'Não foi possível criar a conta. Tente outro e-mail.'

export async function signupAccount(
  supabaseService: SupabaseClient<Database>,
  rawInput: unknown,
  context: SignupContext = {},
): Promise<SignupResult> {
  const parsed = signupSchema.safeParse(rawInput)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new ValidationError(first?.message ?? 'invalid signup payload', {
      issues: parsed.error.issues,
    })
  }
  const { fullName, email, password } = parsed.data

  const { data: created, error: createError } = await supabaseService.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: { full_name: fullName },
  })

  if (createError || !created?.user) {
    logger.warn(
      {
        message: createError?.message ?? 'unknown',
        ip: context.ip ?? null,
      },
      'signup-create-user-failed',
    )
    // Anti-enumeration — toda falha de createUser vira mensagem genérica.
    throw new ConflictError('SIGNUP_FAILED', GENERIC_FAILURE)
  }

  const userId = created.user.id

  // Audit (sem tenant ainda — schema requer tenant_id NOT NULL, então
  // logamos apenas no logger por enquanto. Quando o usuário criar o
  // primeiro tenant via onboarding, o audit de tenant.create cobre
  // a transição vinda do signup).
  logger.info(
    { user_id: userId, email, ip: context.ip ?? null },
    'signup-account-created',
  )

  return { userId }
}

import { z } from 'zod'

/**
 * Cápsula `memed/` — schemas e tipos compartilhados (Feature 026).
 *
 * Princípio de segurança: `api_key`/`secret_key` são SEGREDOS — nunca
 * trafegam para o frontend nem aparecem em logs (ver `mask-pii.ts`). Os
 * schemas "public" abaixo são os únicos seguros para serializar à UI.
 */

export const MEMED_ENVIRONMENTS = ['staging', 'production'] as const
export type MemedEnvironment = (typeof MEMED_ENVIRONMENTS)[number]
export const memedEnvironmentSchema = z.enum(MEMED_ENVIRONMENTS)

/** Credenciais Memed cifradas em repouso. NUNCA expor ao browser. */
export const memedCredentialsSchema = z.object({
  api_key: z.string().min(1),
  secret_key: z.string().min(1),
})
export type MemedCredentials = z.infer<typeof memedCredentialsSchema>

/** Visão não-secreta da conexão — seguro para resposta de API/UI. */
export const memedConfigPublicSchema = z.object({
  environment: memedEnvironmentSchema,
  connected: z.boolean(),
  termsAcceptedAt: z.string().nullable(),
})
export type MemedConfigPublic = z.infer<typeof memedConfigPublicSchema>

/** Conselho profissional (board) — parte do cadastro de prescritor. */
export const memedBoardSchema = z.object({
  board_code: z.string().min(1),
  board_number: z.string().min(1),
  board_state: z.string().length(2),
})

/**
 * Payload de cadastro/atualização de prescritor.
 * `POST /sinapse-prescricao/usuarios` (contrato memed-external-api.md).
 */
export const memedPrescriberPayloadSchema = z.object({
  external_id: z.string().uuid(),
  nome: z.string().min(1),
  sobrenome: z.string().min(1),
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve ter 11 dígitos'),
  board: memedBoardSchema,
  data_nascimento: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, 'data_nascimento deve ser dd/mm/aaaa'),
  email: z.string().email().optional(),
  telefone: z.string().optional(),
  sexo: z.enum(['M', 'F']).optional(),
  especialidade: z.string().optional(),
  cidade: z.string().optional(),
})
export type MemedPrescriberPayload = z.infer<typeof memedPrescriberPayloadSchema>

/**
 * Payload do comando `setPaciente` (montado server-side com dados decifrados,
 * entregue ao frontend que o repassa ao MdHub). Sem campos secretos.
 */
export const memedSetPacientePayloadSchema = z.object({
  external_id: z.string(),
  nome: z.string().min(1),
  cpf: z.string().optional(),
  sexo: z.enum(['M', 'F']).optional(),
  data_nascimento: z.string().optional(),
  telefone: z.string().optional(),
  email: z.string().optional(),
  endereco: z
    .object({
      cep: z.string().optional(),
      logradouro: z.string().optional(),
      numero: z.string().optional(),
      complemento: z.string().optional(),
      bairro: z.string().optional(),
      cidade: z.string().optional(),
      estado: z.string().optional(),
    })
    .optional(),
})
export type MemedSetPacientePayload = z.infer<typeof memedSetPacientePayloadSchema>

/** Item do catálogo de especialidades (de-para FR-020). */
export const memedSpecialtySchema = z.object({
  id: z.string(),
  nome: z.string(),
})
export type MemedSpecialty = z.infer<typeof memedSpecialtySchema>

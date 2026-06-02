import { http, HttpResponse } from 'msw'
import { mswServer } from './msw-server'
import { serviceClient } from './supabase-test-client'

/**
 * Mock da API externa da Memed para a suíte (Feature 026/027). Intercepta os
 * endpoints de prescritor via MSW e expõe seeds das tabelas Memed. NUNCA bate
 * na Memed real — `setup.ts` usa `onUnhandledRequest: 'bypass'`, então todo
 * teste que exercita a cápsula DEVE chamar `mockMemed()` antes.
 */

const STAGING_BASE = 'https://integrations.api.memed.com.br/v1'

export interface MockMemedOptions {
  /** Token devolvido no cadastro/busca de prescritor. */
  token?: string
  /** Quando >= 400, o POST /usuarios responde erro (testa caminho de validação). */
  registerStatus?: number
  registerError?: unknown
  /** Catálogo de especialidades devolvido em GET /especialidades. */
  specialties?: Array<{ id: string; nome: string }>
}

const DEFAULT_SPECIALTIES = [
  { id: '10', nome: 'Cardiologia' },
  { id: '20', nome: 'Clínica Geral' },
]

export function mockMemed(opts: MockMemedOptions = {}): { token: string } {
  const token = opts.token ?? 'mock.prescriber.jwt.token'
  const specialties = opts.specialties ?? DEFAULT_SPECIALTIES
  mswServer.use(
    http.post(`${STAGING_BASE}/sinapse-prescricao/usuarios`, () => {
      if (opts.registerStatus && opts.registerStatus >= 400) {
        return HttpResponse.json(
          opts.registerError ?? { errors: [{ detail: 'Campo obrigatório ausente' }] },
          { status: opts.registerStatus },
        )
      }
      return HttpResponse.json(
        { data: { type: 'usuarios', attributes: { token } } },
        { status: 200 },
      )
    }),
    http.get(`${STAGING_BASE}/sinapse-prescricao/usuarios/:id`, () =>
      HttpResponse.json({ data: { type: 'usuarios', attributes: { token } } }, { status: 200 }),
    ),
    http.get(`${STAGING_BASE}/especialidades`, () =>
      HttpResponse.json(
        { data: specialties.map((s) => ({ id: s.id, type: 'especialidades', attributes: { nome: s.nome } })) },
        { status: 200 },
      ),
    ),
  )
  return { token }
}

export interface SeedMemedConnectionOptions {
  createdBy: string
  apiKey?: string
  secretKey?: string
  environment?: 'staging' | 'production'
  connected?: boolean
}

export async function seedMemedConnection(
  tenantId: string,
  opts: SeedMemedConnectionOptions,
): Promise<{ apiKey: string; secretKey: string }> {
  const sb = serviceClient()
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY not set for tests')
  const apiKey = opts.apiKey ?? 'mock_api_key_value'
  const secretKey = opts.secretKey ?? 'mock_secret_key_value'

  const { data: apiEnc, error: e1 } = await sb.rpc('enc_text_with_key', { plain: apiKey, key })
  if (e1) throw new Error(`enc api_key failed: ${e1.message}`)
  const { data: secretEnc, error: e2 } = await sb.rpc('enc_text_with_key', { plain: secretKey, key })
  if (e2) throw new Error(`enc secret_key failed: ${e2.message}`)

  await sb
    .from('tenant_memed_config')
    .insert({
      tenant_id: tenantId,
      environment: opts.environment ?? 'staging',
      api_key_enc: apiEnc as unknown as string,
      secret_key_enc: secretEnc as unknown as string,
      connected: opts.connected ?? true,
      created_by_user_id: opts.createdBy,
    } as never)
    .throwOnError()
  return { apiKey, secretKey }
}

export async function seedMemedPrescriber(
  tenantId: string,
  doctorId: string,
  opts: { createdBy: string; status?: 'pending' | 'registered' | 'error'; externalId?: string },
): Promise<void> {
  const sb = serviceClient()
  await sb
    .from('memed_prescribers')
    .insert({
      tenant_id: tenantId,
      doctor_id: doctorId,
      external_id: opts.externalId ?? doctorId,
      status: opts.status ?? 'registered',
      created_by_user_id: opts.createdBy,
    } as never)
    .throwOnError()
}

/** Preenche os campos de prescritor exigidos pela Memed num doctor já semeado. */
export async function setDoctorPrescriberFields(
  doctorId: string,
  tenantId: string,
  opts: { cpf?: string; councilName?: string; councilNumber?: string; councilState?: string; birthDate?: string } = {},
): Promise<void> {
  const sb = serviceClient()
  await sb
    .from('doctors')
    .update({
      cpf: opts.cpf ?? '39053344705',
      council_name: opts.councilName ?? 'CRM',
      council_number: opts.councilNumber ?? '123456',
      council_state: opts.councilState ?? 'SP',
      birth_date: opts.birthDate ?? '1985-04-12',
    } as never)
    .eq('id', doctorId)
    .eq('tenant_id', tenantId)
    .throwOnError()
}

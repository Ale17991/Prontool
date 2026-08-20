/**
 * O link que o convidado e quem esqueceu a senha recebem.
 *
 * O convite não tinha teste nenhum, e foi reescrito duas vezes em 19/08/2026
 * por dois defeitos que só apareceram em produção — os dois no formato do link
 * e em quem o envia:
 *
 *   1. quem mandava era o Supabase, do remetente do PROJETO, e não a Clinni de
 *      `nao-responda@clinnipro.com.br`;
 *   2. o destino era `/welcome`, uma rota que NÃO EXISTE neste app e que o
 *      middleware nem libera — o convidado recebia, de um endereço estranho, um
 *      link que terminava em 404.
 *
 * Nenhum dos dois seria pego por typecheck ou lint: os dois lados compilam. O
 * que os pega é afirmar, aqui, para onde o link aponta e por qual remetente ele
 * sai. É unitário de propósito — `issueResetLink` só toca `generateLink` e o
 * envio, então não precisa de banco e não paga o preço do `resetDatabase`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

interface EnvioArgs {
  to: string
  actionLink: string
}
interface EnvioResultado {
  id: string | null
  detail?: string
}

// O parâmetro é DECLARADO nos dublês, e não inferido: `vi.fn(async () => ...)`
// infere função de zero argumentos, e aí `mock.calls[0][0]` não existe para o
// TypeScript — o teste roda e o `typecheck` reprova.
const { sendInviteMock, sendResetMock } = vi.hoisted(() => ({
  sendInviteMock: vi.fn(async (_args: EnvioArgs): Promise<EnvioResultado> => ({ id: 'inv_1' })),
  sendResetMock: vi.fn(async (_args: EnvioArgs): Promise<EnvioResultado> => ({ id: 'rec_1' })),
}))

vi.mock('@/lib/integrations/email/resend-client', () => ({
  sendInviteEmail: sendInviteMock,
  sendPasswordResetEmail: sendResetMock,
}))

import { issueResetLink } from '@/lib/core/auth/password-reset'

const BASE = 'https://app.clinnipro.com.br'

/**
 * O dublê expõe só o que `issueResetLink` usa. Fosse um cliente de verdade,
 * este arquivo viraria teste de integração e passaria a apagar o banco local
 * para verificar formatação de URL.
 */
function fakeSupabase(properties: Record<string, string> | null, error?: string) {
  const generateLink = vi.fn(async (_args: { type: string; email: string }) => ({
    data: properties ? { properties } : null,
    error: error ? { message: error } : null,
  }))
  return { client: { auth: { admin: { generateLink } } } as never, generateLink }
}

beforeEach(() => {
  sendInviteMock.mockClear()
  sendResetMock.mockClear()
  sendInviteMock.mockResolvedValue({ id: 'inv_1' })
  sendResetMock.mockResolvedValue({ id: 'rec_1' })
})

describe('issueResetLink — para onde o link aponta', () => {
  it('leva à nossa página, com o token e o tipo — nunca a /welcome', async () => {
    const { client } = fakeSupabase({ hashed_token: 'abc123' })
    const r = await issueResetLink(client, {
      email: 'ana@clinica.com',
      baseUrl: BASE,
      tipo: 'invite',
    })

    expect(r.sent).toBe(true)
    const { actionLink } = sendInviteMock.mock.calls[0]![0]
    expect(actionLink).toBe(`${BASE}/redefinir-senha?token_hash=abc123&type=invite`)
    expect(actionLink).not.toContain('/welcome')
  })

  /**
   * O `action_link` do Supabase é o plano B — ele passa pelo endpoint de verify
   * e depende do Site URL e da allowlist de Redirect URLs estarem certos. Só
   * vale quando o `hashed_token` não vier.
   */
  it('cai no action_link do Supabase quando não há hashed_token', async () => {
    const { client } = fakeSupabase({
      action_link: 'https://xyz.supabase.co/auth/v1/verify?token=t',
    })
    await issueResetLink(client, { email: 'ana@clinica.com', baseUrl: BASE })

    const { actionLink } = sendResetMock.mock.calls[0]![0]
    expect(actionLink).toBe('https://xyz.supabase.co/auth/v1/verify?token=t')
  })

  it('token com caractere especial vai percent-encoded', async () => {
    const { client } = fakeSupabase({ hashed_token: 'a+b/c=d' })
    await issueResetLink(client, { email: 'ana@clinica.com', baseUrl: BASE })

    const { actionLink } = sendResetMock.mock.calls[0]![0]
    expect(actionLink).toContain('token_hash=a%2Bb%2Fc%3Dd')
  })

  it('barra sobrando na base não vira barra dupla no link', async () => {
    const { client } = fakeSupabase({ hashed_token: 'abc' })
    await issueResetLink(client, { email: 'ana@clinica.com', baseUrl: `${BASE}///` })

    const { actionLink } = sendResetMock.mock.calls[0]![0]
    expect(actionLink).toBe(`${BASE}/redefinir-senha?token_hash=abc&type=recovery`)
  })
})

describe('issueResetLink — quem envia', () => {
  it('convite sai pelo NOSSO envio de convite, não pelo Supabase', async () => {
    const { client } = fakeSupabase({ hashed_token: 'abc' })
    await issueResetLink(client, { email: 'ana@clinica.com', baseUrl: BASE, tipo: 'invite' })

    expect(sendInviteMock).toHaveBeenCalledTimes(1)
    expect(sendResetMock).not.toHaveBeenCalled()
  })

  it('recuperação sai pelo envio de recuperação, e é o padrão', async () => {
    const { client } = fakeSupabase({ hashed_token: 'abc' })
    await issueResetLink(client, { email: 'ana@clinica.com', baseUrl: BASE })

    expect(sendResetMock).toHaveBeenCalledTimes(1)
    expect(sendInviteMock).not.toHaveBeenCalled()
  })

  /**
   * `  Ana@Clinica.COM ` e `ana@clinica.com` são a mesma caixa. Sem normalizar,
   * o Supabase não acharia a conta e o e-mail sairia com o endereço torto.
   */
  it('normaliza o e-mail antes de gerar o link e antes de enviar', async () => {
    const { client, generateLink } = fakeSupabase({ hashed_token: 'abc' })
    await issueResetLink(client, { email: '  Ana@Clinica.COM ', baseUrl: BASE })

    expect(generateLink.mock.calls[0]![0].email).toBe('ana@clinica.com')
    expect(sendResetMock.mock.calls[0]![0].to).toBe('ana@clinica.com')
  })
})

describe('issueResetLink — quando não dá', () => {
  it('erro do Supabase não vira envio', async () => {
    const { client } = fakeSupabase(null, 'user not found')
    const r = await issueResetLink(client, { email: 'ana@clinica.com', baseUrl: BASE })

    expect(r).toEqual({ sent: false, reason: 'no_link', detail: 'user not found' })
    expect(sendResetMock).not.toHaveBeenCalled()
  })

  /**
   * O envio sem id é o sintoma de domínio não verificado no Resend. Precisa
   * chegar ao chamador: o convite NÃO desfaz o vínculo quando isso acontece,
   * mas o reenvio levanta — e os dois dependem deste retorno ser fiel.
   */
  it('envio sem id devolve send_failed com o detalhe', async () => {
    sendResetMock.mockResolvedValue({ id: null, detail: 'domain not verified' })
    const { client } = fakeSupabase({ hashed_token: 'abc' })
    const r = await issueResetLink(client, { email: 'ana@clinica.com', baseUrl: BASE })

    expect(r).toEqual({ sent: false, reason: 'send_failed', detail: 'domain not verified' })
  })
})

import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { resendSpy, qstashSpy, resendArchive, ghlOauthTokenSpy, whatsappSendSpy } from './msw-spies'

/**
 * MSW server used across integration tests. Intercepts outbound calls to
 * third-party services (Resend, QStash) so tests can assert on what the
 * production code tried to send without hitting real endpoints. Every
 * intercepted request is recorded on the matching spy under
 * `tests/helpers/msw-spies.ts`.
 */

interface ResendRequestBody {
  to?: string[] | string
  subject?: string
  html?: string
  text?: string
}

interface QstashRequestBody {
  url?: string
  body?: unknown
}

export const mswServer = setupServer(
  // Feature 051 — serviço de WhatsApp. O host é fake (forçado em setup.ts);
  // se alguma chamada escapar para o host REAL, ela NÃO casa aqui e o
  // onUnhandledRequest:'bypass' deixaria passar — por isso o override do env é
  // a trava primária, e este handler é a rede de segurança.
  http.post('https://whatsapp-service.test/functions/v1/send-message', async ({ request }) => {
    const body = (await request
      .clone()
      .json()
      .catch(() => ({}))) as {
      externalId?: string
      to?: string
    }
    whatsappSendSpy.calls.push({ to: body.to ?? '', externalId: body.externalId ?? '' })
    return HttpResponse.json({
      messageId: `msg-${body.externalId ?? 'x'}`,
      evolutionMessageId: 'evo-1',
      status: 'sent',
    })
  }),

  http.post('https://api.resend.com/emails', async ({ request }) => {
    const body = (await request
      .clone()
      .json()
      .catch(() => ({}))) as ResendRequestBody
    const call = {
      to: body.to,
      subject: body.subject,
      body: body.text ?? body.html,
      html: body.html,
    }
    resendSpy.record(call)
    resendArchive.record(call)
    return HttpResponse.json({ id: `resend_mock_${Date.now()}` }, { status: 200 })
  }),

  http.post('https://qstash.upstash.io/v2/publish/*', async ({ request }) => {
    const body = await request
      .clone()
      .json()
      .catch(() => null)
    qstashSpy.record({ url: request.url, body })
    return HttpResponse.json({ messageId: `qstash_mock_${Date.now()}` }, { status: 200 })
  }),

  // Feature 008 — GHL OAuth token endpoint.
  http.post('https://services.leadconnectorhq.com/oauth/token', async ({ request }) => {
    const bodyRaw = await request.clone().text()
    const body = new URLSearchParams(bodyRaw)
    const headers: Record<string, string> = {}
    request.headers.forEach((v, k) => {
      headers[k] = v
    })
    ghlOauthTokenSpy.record({ body, bodyRaw, headers })
    const next = ghlOauthTokenSpy.nextResponse()
    if (typeof next.body === 'string') {
      return new HttpResponse(next.body, { status: next.status })
    }
    return HttpResponse.json(next.body, { status: next.status })
  }),
)

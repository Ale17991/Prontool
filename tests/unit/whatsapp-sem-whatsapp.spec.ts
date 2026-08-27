/**
 * 0210 — o número que não tem WhatsApp precisa ser distinguível da falha.
 *
 * Em 26/08/2026 uma mensagem de automação não saiu, e a Evolution disse por
 * quê, textualmente: `exists:false`. O braço traduz esse 400 para 502 e repassa
 * a mensagem crua; sem ler o corpo, tudo isso virava `send_failed` — que desde
 * a 0203 é RETENTÁVEL, e que dispara o alerta de "confira a conexão do número"
 * quando a conexão está perfeita.
 */
import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { mswServer } from '@/tests/helpers/msw-server'
import { sendText } from '@/lib/core/whatsapp/service-client'

const ROTA = 'https://whatsapp-service.test/functions/v1/send-message'

/** A resposta real do braço, copiada de produção (só o número foi trocado). */
function respostaDoBraco(erro: string, status = 502) {
  return http.post(ROTA, () =>
    HttpResponse.json({ messageId: 'm-1', status: 'error', error: erro }, { status }),
  )
}

async function enviar() {
  return sendText({
    apiKey: 'ck_teste',
    to: '5516981552025',
    message: 'oi',
    externalId: 'ext-1',
  })
}

describe('classificação de "o número não tem WhatsApp"', () => {
  it('reconhece o exists:false que a Evolution devolve', async () => {
    mswServer.use(
      respostaDoBraco(
        'Evolution sendText 400: {"status":400,"error":"Bad Request","response":{"message":[{"jid":"5516981552025@s.whatsapp.net","exists":false,"number":"5516981552025"}]}}',
      ),
    )
    const res = await enviar()
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.kind).toBe('no_whatsapp')
  })

  /**
   * A fronteira que importa: 502 continua sendo falha retentável. Confundir os
   * dois nos dois sentidos custa caro — tratar indisponibilidade como estado do
   * mundo perde a mensagem para sempre, e tratar estado do mundo como
   * indisponibilidade queima três vagas do ciclo contra um número inexistente.
   */
  it('502 comum continua send_failed', async () => {
    mswServer.use(respostaDoBraco('Bad Gateway'))
    const res = await enviar()
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.kind).toBe('send_failed')
  })

  it('a ausência de conexão (409) não é confundida com número sem WhatsApp', async () => {
    mswServer.use(
      http.post(ROTA, () =>
        HttpResponse.json({ error: 'No connected instance for this tenant' }, { status: 409 }),
      ),
    )
    const res = await enviar()
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.kind).toBe('no_connection')
  })

  it('sucesso segue sucesso', async () => {
    mswServer.use(
      http.post(ROTA, () =>
        HttpResponse.json({ messageId: 'm-9', status: 'sent' }, { status: 200 }),
      ),
    )
    const res = await enviar()
    expect(res.ok).toBe(true)
  })
})

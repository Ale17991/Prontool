/**
 * T029 (Feature 027 / FR-012) — o Pino mascara segredos da Memed nos logs.
 *
 * Usa os MESMOS paths/censor de produção (`REDACTION_PATHS`/`REDACT_CENSOR`)
 * num logger com sink capturável. Um payload com api_key/secret_key NUNCA
 * aparece em texto claro no log.
 */
import { describe, it, expect } from 'vitest'
import { Writable } from 'node:stream'
import pino from 'pino'
import { REDACTION_PATHS, REDACT_CENSOR } from '@/lib/observability/logger'

function captureLogger() {
  const chunks: string[] = []
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString())
      cb()
    },
  })
  const log = pino({ redact: { paths: REDACTION_PATHS, censor: REDACT_CENSOR } }, sink)
  return { log, output: () => chunks.join('') }
}

describe('Feature 027 — pino redact dos segredos Memed', () => {
  it('mascara api_key e secret_key aninhados em config', () => {
    const { log, output } = captureLogger()
    log.info(
      { config: { api_key: 'mk_super_secret_123456', secret_key: 'sk_super_secret_654321' } },
      'memed call',
    )
    const out = output()
    expect(out).not.toContain('mk_super_secret_123456')
    expect(out).not.toContain('sk_super_secret_654321')
    expect(out).toContain(REDACT_CENSOR)
  })

  it('mascara api_key/secret_key no nível superior', () => {
    const { log, output } = captureLogger()
    log.info({ api_key: 'mk_topo_aaaaaaaaaaaa', secret_key: 'sk_topo_bbbbbbbbbbbb' }, 'memed')
    const out = output()
    expect(out).not.toContain('mk_topo_aaaaaaaaaaaa')
    expect(out).not.toContain('sk_topo_bbbbbbbbbbbb')
  })

  it('mascara credentials_enc', () => {
    const { log, output } = captureLogger()
    log.info({ config: { credentials_enc: '\\xDEADBEEFcafe' } }, 'memed config')
    expect(output()).not.toContain('DEADBEEFcafe')
  })
})

import { Receiver } from '@upstash/qstash'
import { InvalidSignatureError } from '@/lib/observability/errors'

let receiverSingleton: Receiver | null = null

export function isQstashSigningConfigured(): boolean {
  return (
    Boolean(process.env.QSTASH_CURRENT_SIGNING_KEY) &&
    Boolean(process.env.QSTASH_NEXT_SIGNING_KEY)
  )
}

function getReceiver(): Receiver {
  if (receiverSingleton) return receiverSingleton
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY
  const next = process.env.QSTASH_NEXT_SIGNING_KEY
  if (!current || !next) throw new Error('QSTASH signing keys missing')
  receiverSingleton = new Receiver({ currentSigningKey: current, nextSigningKey: next })
  return receiverSingleton
}

export async function verifyQstashSignature(args: {
  signature: string | null
  body: string
  url: string
}): Promise<void> {
  if (!args.signature) throw new InvalidSignatureError('Missing Upstash-Signature header')

  const ok = await getReceiver()
    .verify({ signature: args.signature, body: args.body, url: args.url })
    .catch(() => false)

  if (!ok) throw new InvalidSignatureError('QStash signature verification failed')
}

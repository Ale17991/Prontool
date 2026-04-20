#!/usr/bin/env tsx
/**
 * T147 — Webhook performance benchmark.
 *
 * Hammers `/api/webhooks/ghl` with signed payloads and records wall-clock
 * latency percentiles (p50/p95/p99). Validates SC-001a:
 * 99% of webhooks must get a 2xx ack in under 1 s (measured p99).
 *
 * Each request gets a fresh `event_id` so the handler never short-circuits
 * on `ON CONFLICT DO NOTHING` — the deduplication path is semantically
 * different and would understate real ingestion cost.
 *
 * Usage:
 *   pnpm bench:webhook \
 *     --tenant-slug clinica-demo \
 *     --duration-sec 60 \
 *     --concurrency 20
 *
 * Prereqs:
 *   1. `pnpm seed:demo` has run (so the tenant + config + secret exist)
 *   2. Next.js is running at --app-url (defaults to http://localhost:3000)
 *   3. Supabase local is up (the handler will hit it for every request)
 */
import { createHmac, randomUUID } from 'node:crypto'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'

interface CliArgs {
  tenantSlug: string
  appUrl: string
  durationSec: number
  concurrency: number
  warmup: number
}

function parseArgs(argv: string[]): CliArgs {
  const map = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token || !token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      map.set(key, next)
      i++
    } else {
      map.set(key, 'true')
    }
  }
  return {
    tenantSlug: map.get('tenant-slug') ?? 'clinica-demo',
    appUrl: map.get('app-url') ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    durationSec: Number(map.get('duration-sec') ?? '30'),
    concurrency: Number(map.get('concurrency') ?? '10'),
    warmup: Number(map.get('warmup') ?? '20'),
  }
}

interface Sample {
  latencyMs: number
  status: number
  duplicate: boolean
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sorted[lo]!
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo)
}

async function resolveWebhookSecret(tenantSlug: string): Promise<string> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY required to decrypt webhook_secret')

  const sb = createSupabaseServiceClient()
  const tenant = await sb.from('tenants').select('id').eq('slug', tenantSlug).single()
  if (tenant.error || !tenant.data) {
    throw new Error(`tenant slug '${tenantSlug}' not found — run pnpm seed:demo first`)
  }
  const config = await sb
    .from('tenant_ghl_config')
    .select('webhook_secret_enc')
    .eq('tenant_id', tenant.data.id)
    .single()
  if (config.error || !config.data) {
    throw new Error(`tenant_ghl_config missing for '${tenantSlug}'`)
  }
  const { data: secret, error } = await sb.rpc('dec_text_with_key', {
    cipher: config.data.webhook_secret_enc as unknown as string,
    key,
  })
  if (error || typeof secret !== 'string') {
    throw new Error(`dec_text_with_key failed: ${error?.message}`)
  }
  return secret
}

function buildSignedRequest(args: {
  url: string
  secret: string
}): { url: string; init: RequestInit } {
  const payload = {
    event_id: `bench_${randomUUID()}`,
    event_type: 'pipeline_stage_changed',
    occurred_at: new Date().toISOString(),
    contact: {
      id: `ghl_contact_${randomUUID().slice(0, 8)}`,
      custom_fields: {
        plano: 'Unimed',
        tuss: '10101012',
        medico_id: 'CRM-12345',
        patient_name: 'Bench Patient',
        patient_cpf: '00000000000',
      },
    },
    pipeline: { id: 'bench-pipeline', stage_name: 'atendimento' },
  }
  const raw = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = createHmac('sha256', args.secret).update(`${timestamp}.${raw}`).digest('hex')
  return {
    url: args.url,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ghl-signature': signature,
        'x-ghl-timestamp': timestamp,
      },
      body: raw,
    },
  }
}

async function worker(opts: {
  url: string
  secret: string
  deadline: number
  samples: Sample[]
}): Promise<void> {
  while (Date.now() < opts.deadline) {
    const { url, init } = buildSignedRequest({ url: opts.url, secret: opts.secret })
    const started = performance.now()
    let status = 0
    let duplicate = false
    try {
      const res = await fetch(url, init)
      status = res.status
      const body = (await res.json().catch(() => null)) as { duplicate?: boolean } | null
      duplicate = body?.duplicate === true
    } catch {
      status = 0
    }
    opts.samples.push({ latencyMs: performance.now() - started, status, duplicate })
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  console.info('[bench-webhook] config', args)

  const secret = await resolveWebhookSecret(args.tenantSlug)
  const url = `${args.appUrl.replace(/\/$/, '')}/api/webhooks/ghl`

  // Warmup (not counted)
  console.info(`[bench-webhook] warming up: ${args.warmup} sequential requests`)
  for (let i = 0; i < args.warmup; i++) {
    const { init } = buildSignedRequest({ url, secret })
    await fetch(url, init).then((r) => r.text())
  }

  console.info(
    `[bench-webhook] running: concurrency=${args.concurrency} duration=${args.durationSec}s`,
  )
  const samples: Sample[] = []
  const deadline = Date.now() + args.durationSec * 1000
  const startedAt = performance.now()
  await Promise.all(
    Array.from({ length: args.concurrency }, () =>
      worker({ url, secret, deadline, samples }),
    ),
  )
  const elapsedSec = (performance.now() - startedAt) / 1000

  const latencies = samples.map((s) => s.latencyMs).sort((a, b) => a - b)
  const ok = samples.filter((s) => s.status >= 200 && s.status < 300).length
  const errors = samples.length - ok
  const duplicates = samples.filter((s) => s.duplicate).length

  const summary = {
    total_requests: samples.length,
    elapsed_sec: Number(elapsedSec.toFixed(2)),
    rps: Number((samples.length / elapsedSec).toFixed(1)),
    success_rate: Number(((ok / samples.length) * 100).toFixed(2)),
    error_count: errors,
    duplicate_count: duplicates,
    latency_ms: {
      min: Number((latencies[0] ?? 0).toFixed(1)),
      avg: Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1)),
      p50: Number(percentile(latencies, 50).toFixed(1)),
      p95: Number(percentile(latencies, 95).toFixed(1)),
      p99: Number(percentile(latencies, 99).toFixed(1)),
      max: Number((latencies[latencies.length - 1] ?? 0).toFixed(1)),
    },
    sc_001a_pass: percentile(latencies, 99) < 1000,
  }

  console.info(JSON.stringify(summary, null, 2))
  if (!summary.sc_001a_pass) {
    console.error('[bench-webhook] SC-001a FAIL: p99 latency exceeded 1000 ms')
    process.exit(1)
  }
}

main().catch((err: unknown) => {
  console.error('[bench-webhook] fatal:', err)
  process.exit(1)
})

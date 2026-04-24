#!/usr/bin/env tsx
/**
 * T098 — Simulate a GHL webhook delivery against the local dev API.
 *
 * Looks up the target tenant's `webhook_secret` from `tenant_ghl_config`,
 * builds a realistic pipeline_stage_changed payload with the CLI-supplied
 * custom fields, signs it with HMAC-SHA256 over `${timestamp}.${body}`,
 * and POSTs to `/api/webhooks/ghl` on the local app.
 *
 * Example:
 *   pnpm simulate:webhook \
 *     --tenant-slug clinica-demo \
 *     --event-id evt_0001 \
 *     --plano Unimed \
 *     --tuss 10101012 \
 *     --medico-id CRM-12345 \
 *     --patient-name "Maria Teste" \
 *     --patient-cpf "123.456.789-00" \
 *     --patient-email "maria@test.com" \
 *     --patient-phone "+5511999999999" \
 *     --patient-birth-date "1990-03-15"
 */
import { createHmac, randomUUID } from 'node:crypto'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'

interface CliArgs {
  tenantSlug: string
  eventId: string
  plano: string
  tuss: string
  medicoId: string
  patientName: string
  patientCpf: string
  patientEmail?: string
  patientPhone?: string
  patientBirthDate?: string
  appUrl: string
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
  const required = [
    'tenant-slug',
    'event-id',
    'plano',
    'tuss',
    'medico-id',
    'patient-name',
    'patient-cpf',
  ] as const
  for (const r of required) {
    if (!map.get(r)) {
      console.error(`Missing required flag: --${r}`)
      process.exit(2)
    }
  }
  return {
    tenantSlug: map.get('tenant-slug') as string,
    eventId: map.get('event-id') as string,
    plano: map.get('plano') as string,
    tuss: map.get('tuss') as string,
    medicoId: map.get('medico-id') as string,
    patientName: map.get('patient-name') as string,
    patientCpf: map.get('patient-cpf') as string,
    patientEmail: map.get('patient-email'),
    patientPhone: map.get('patient-phone'),
    patientBirthDate: map.get('patient-birth-date'),
    appUrl: map.get('app-url') ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY required to decrypt webhook_secret')

  const sb = createSupabaseServiceClient()
  const tenant = await sb.from('tenants').select('id').eq('slug', args.tenantSlug).single()
  if (tenant.error || !tenant.data) {
    throw new Error(`tenant slug '${args.tenantSlug}' not found`)
  }

  const config = await sb
    .from('tenant_ghl_config')
    .select('webhook_secret_enc')
    .eq('tenant_id', tenant.data.id)
    .single()
  if (config.error || !config.data) {
    throw new Error(`tenant_ghl_config for '${args.tenantSlug}' not found`)
  }

  const { data: secret, error: decErr } = await sb.rpc('dec_text_with_key', {
    cipher: config.data.webhook_secret_enc as unknown as string,
    key,
  })
  if (decErr || typeof secret !== 'string') {
    throw new Error(`dec_text_with_key failed: ${decErr?.message}`)
  }

  const payload = {
    event_id: args.eventId,
    event_type: 'pipeline_stage_changed',
    occurred_at: new Date().toISOString(),
    contact: {
      id: `ghl_contact_${randomUUID().slice(0, 8)}`,
      custom_fields: {
        plano: args.plano,
        tuss: args.tuss,
        medico_id: args.medicoId,
        patient_name: args.patientName,
        patient_cpf: args.patientCpf,
        ...(args.patientEmail ? { patient_email: args.patientEmail } : {}),
        ...(args.patientPhone ? { patient_phone: args.patientPhone } : {}),
        ...(args.patientBirthDate ? { patient_birth_date: args.patientBirthDate } : {}),
      },
    },
    pipeline: { id: 'demo-pipeline', stage_name: 'atendimento' },
  }

  const rawBody = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')

  const url = `${args.appUrl.replace(/\/$/, '')}/api/webhooks/ghl`
  console.info(`[simulate] POST ${url}`)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ghl-signature': signature,
      'x-ghl-timestamp': timestamp,
    },
    body: rawBody,
  })
  const body = await res.text()
  console.info(`[simulate] HTTP ${res.status}`)
  console.info(body)
  if (!res.ok) process.exit(1)
}

main().catch((err: unknown) => {
  console.error('[simulate] FAILED:', err)
  process.exit(1)
})

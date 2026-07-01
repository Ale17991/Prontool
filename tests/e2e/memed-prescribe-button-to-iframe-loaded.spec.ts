/**
 * T032a (spec 027, US5/SC-008) — performance de abertura da prescrição.
 *
 * Mede o tempo entre o clique em "Prescrever" e o iframe totalmente carregado
 * com o paciente correto (setPaciente aplicado). 20 iterações; assert
 * p95 ≤ 3000ms. Imprime min/p50/p95/p99 para tracking.
 */
import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './fixtures'
import {
  seedMemedFixture,
  stubMemedSdk,
  openPrescription,
  type MemedE2eFixture,
} from './memed-helpers'

const ITERATIONS = 20
// SC-008: p95 ≤ 3s vale no build de produção (CI, `pnpm start`). Em dev mode
// o overhead de compile/HMR/decrypt do Next domina (~10s) e não diz nada sobre
// produção — localmente o assert vira sanidade (30s) e os percentis são sempre
// impressos para tracking manual.
const P95_BUDGET_MS = process.env.CI ? 3000 : 30_000

let fixture: MemedE2eFixture

test.beforeAll(async () => {
  fixture = await seedMemedFixture()
})

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]!
}

test('clique em Prescrever → iframe carregado com paciente: p95 ≤ 3s (20 iterações)', async ({
  page,
}) => {
  test.setTimeout(10 * 60_000)
  await stubMemedSdk(page)
  await loginAsAdmin(page)

  // Warmup (dev server compila a página no primeiro hit) — não conta.
  await openPrescription(page, fixture.appointmentId, fixture.patientName)

  const samples: number[] = []
  for (let i = 0; i < ITERATIONS; i++) {
    const ms = await openPrescription(page, fixture.appointmentId, fixture.patientName)
    samples.push(ms)
  }

  const sorted = [...samples].sort((a, b) => a - b)
  const stats = {
    min: sorted[0]!,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  }
  console.info(
    `[memed-perf] n=${ITERATIONS} min=${stats.min}ms p50=${stats.p50}ms p95=${stats.p95}ms p99=${stats.p99}ms`,
  )
  expect(stats.p95).toBeLessThanOrEqual(P95_BUDGET_MS)
})

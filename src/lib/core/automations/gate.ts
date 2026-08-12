/**
 * Feature 056 — gate de módulo compartilhado pelas rotas.
 *
 * Existe como helper porque são sete arquivos de rota e repetir a checagem em
 * cada um é o jeito mais fácil de uma delas nascer sem ela.
 *
 * O gate da TELA não substitui o gate do MOTOR (`evaluate.ts`): `automations.
 * active` é estado persistido, então uma clínica que teve o módulo revogado
 * continuaria enviando para sempre se a checagem morasse só aqui.
 */

import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'

export async function hasAutomationsModule(tenantId: string): Promise<boolean> {
  const ent = await getTenantEntitlements(createSupabaseServiceClient(), tenantId)
  return ent.hasModule('automacoes')
}

export function moduleDisabled(): Response {
  return NextResponse.json(
    { error: { code: 'MODULE_DISABLED', message: 'Módulo indisponível.' } },
    { status: 404 },
  )
}

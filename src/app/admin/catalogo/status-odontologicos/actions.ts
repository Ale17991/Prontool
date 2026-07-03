'use server'

import { revalidatePath } from 'next/cache'
import { superAdminUserId } from '@/lib/auth/platform-admin'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createStatus } from '@/lib/core/dental/status-catalog/create'
import { updateStatus } from '@/lib/core/dental/status-catalog/update'
import { DomainError } from '@/lib/observability/errors'
import type { DentalStatusScope } from '@/lib/core/dental/status-catalog/list'

export interface ActionResult {
  ok: boolean
  error?: string
}

const SCOPES: DentalStatusScope[] = ['tooth', 'face', 'both']
const PATH = '/admin/catalogo/status-odontologicos'

function toError(err: unknown): ActionResult {
  if (err instanceof DomainError) return { ok: false, error: err.message }
  return { ok: false, error: 'Algo deu errado. Tente novamente.' }
}

export async function createStatusAction(input: {
  code: string
  label: string
  color: string
  icon?: string | null
  scope: string
  tussCode?: string | null
  sortOrder?: number
}): Promise<ActionResult> {
  const actorUserId = await superAdminUserId()
  if (!actorUserId) return { ok: false, error: 'Não autorizado.' }

  if (!/^[a-z][a-z0-9_]{1,47}$/.test(input.code)) {
    return {
      ok: false,
      error: 'Código inválido: use minúsculas, números e _ (começando por letra).',
    }
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(input.color)) {
    return { ok: false, error: 'Cor inválida: use formato hex #RRGGBB.' }
  }
  if (!SCOPES.includes(input.scope as DentalStatusScope)) {
    return { ok: false, error: 'Escopo inválido.' }
  }

  try {
    const sb = createSupabaseServiceClient()
    await createStatus(sb, {
      code: input.code,
      label: input.label,
      color: input.color,
      icon: input.icon ?? null,
      scope: input.scope as DentalStatusScope,
      tussCode: input.tussCode ?? null,
      sortOrder: input.sortOrder,
      actorUserId,
    })
    revalidatePath(PATH)
    return { ok: true }
  } catch (err) {
    return toError(err)
  }
}

export async function updateStatusAction(input: {
  id: string
  label?: string
  color?: string
  icon?: string | null
  scope?: string
  tussCode?: string | null
  sortOrder?: number
  isActive?: boolean
}): Promise<ActionResult> {
  const actorUserId = await superAdminUserId()
  if (!actorUserId) return { ok: false, error: 'Não autorizado.' }

  if (input.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(input.color)) {
    return { ok: false, error: 'Cor inválida: use formato hex #RRGGBB.' }
  }
  if (input.scope !== undefined && !SCOPES.includes(input.scope as DentalStatusScope)) {
    return { ok: false, error: 'Escopo inválido.' }
  }

  try {
    const sb = createSupabaseServiceClient()
    await updateStatus(sb, input.id, {
      label: input.label,
      color: input.color,
      icon: input.icon,
      scope: input.scope as DentalStatusScope | undefined,
      tussCode: input.tussCode,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
      actorUserId,
    })
    revalidatePath(PATH)
    return { ok: true }
  } catch (err) {
    return toError(err)
  }
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { resolveIntakeToken, submitIntake } from '@/lib/core/patient-intake'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Público — sem requireRole; o token é a credencial (uso único + expiry).

export async function GET(
  _req: Request,
  { params }: { params: { token: string } },
): Promise<Response> {
  const route = '/api/public/cadastro'
  try {
    const supabase = createSupabaseServiceClient()
    const ctx = await resolveIntakeToken(supabase, params.token)
    if (!ctx) {
      return NextResponse.json(
        { ok: false, error: { code: 'INVALID_TOKEN', message: 'Link inválido ou expirado.' } },
        { status: 404 },
      )
    }
    return NextResponse.json({ ok: true, clinicName: ctx.clinicName }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

const txt = z.string().trim().max(200).nullable().optional()
const postSchema = z.object({
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().max(200).nullable().optional(),
  emergencyContactName: txt,
  emergencyContactPhone: z.string().trim().max(40).nullable().optional(),
  address: z
    .object({
      cep: z.string().trim().max(20).nullable().optional(),
      street: txt,
      number: z.string().trim().max(20).nullable().optional(),
      complement: txt,
      neighborhood: txt,
      city: z.string().trim().max(120).nullable().optional(),
      state: z.string().trim().max(2).nullable().optional(),
    })
    .optional(),
})

export async function POST(
  req: Request,
  { params }: { params: { token: string } },
): Promise<Response> {
  const route = '/api/public/cadastro'
  try {
    const parsed = postSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues },
        },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    await submitIntake(supabase, params.token, parsed.data)
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

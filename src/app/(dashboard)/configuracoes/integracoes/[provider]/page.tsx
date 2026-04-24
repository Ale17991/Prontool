import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Plug } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getAdapter } from '@/lib/integrations/registry'
import { getIntegrationConfig } from '@/lib/core/integrations/config'
import type { Database } from '@/lib/db/types'
import { ProviderForm, type JsonSchema } from './provider-form'

export const dynamic = 'force-dynamic'

type Params = { params: { provider: string } }

export default async function ProviderDetailPage({ params }: Params) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect('/configuracoes')

  const adapter = getAdapter(params.provider)
  if (!adapter) notFound()

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const row = await getIntegrationConfig(supabase, session.tenantId, adapter.provider)

  const connected = Boolean(row)

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/configuracoes/integracoes"
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
        >
          <ChevronLeft className="h-3 w-3" /> Voltar às integrações
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Plug className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black tracking-tight text-slate-900">
                {adapter.label}
              </h1>
              {connected ? (
                <Badge variant="success">Conectado</Badge>
              ) : (
                <Badge variant="secondary">Não configurado</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-500">{adapter.description}</p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            {connected ? 'Reconfigurar credenciais' : 'Conectar'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ProviderForm
            provider={adapter.provider}
            connected={connected}
            configSchema={adapterSchemaToJson(adapter.configSchema)}
            credentialsSchema={adapterSchemaToJson(adapter.credentialsSchema)}
            currentConfig={(row?.config ?? {}) as Record<string, unknown>}
          />
        </CardContent>
      </Card>

      {connected ? (
        <p className="text-xs text-slate-500">
          Conectado desde {row?.created_at ? new Date(row.created_at).toLocaleString('pt-BR') : '—'}. Valores
          secretos nunca são retornados em claro; digite novamente para rotacionar.
        </p>
      ) : null}
    </div>
  )
}

// Adapter schemas are Zod; JSON Schema shape is computed by the route handler,
// but for SSR we can build the same shape inline by inspecting Zod internals.
// We call the API route in the client component to avoid duplicating logic here.
function adapterSchemaToJson(schema: unknown): JsonSchema {
  // Placeholder — ProviderForm fetches /api/configuracoes/integracoes/[provider]
  // on mount (which serializes the JSON Schema via zodToJsonSchema). The SSR
  // form renders blank inputs until the schema loads, which is fine for admin
  // traffic (small tenant, few admins).
  return { type: 'object', properties: {}, required: [] }
}

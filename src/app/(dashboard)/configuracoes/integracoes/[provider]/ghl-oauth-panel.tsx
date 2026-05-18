import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Plug, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { getIntegrationConfig } from '@/lib/core/integrations/config'
import { decryptCredentials } from '@/lib/core/integrations/credentials'
import { listRecentSyncLog } from '@/lib/core/integrations/ghl/sync-log'
import {
  GHL_CUSTOM_FIELD_DEFINITIONS,
  GHL_CUSTOM_FIELD_SLUGS,
  ghlOAuthCredentialsSchema,
  type GhlConfigV2,
  type GhlCustomFieldSlug,
} from '@/lib/integrations/ghl/oauth/types'
import type { Database } from '@/lib/db/types'
import type { TenantRole } from '@/lib/db/types'
import { GhlDisconnectButton } from './ghl-disconnect-button'

/**
 * Feature 008 — Painel SSR da integração GHL com OAuth 2.0.
 *
 * Renderizado em `[provider]/page.tsx` quando provider==='ghl'. Mostra:
 *   - Estado (`not_connected | connected | token_expired | disconnected`)
 *   - Botão Conectar / Reconectar / Desconectar (admin-only)
 *   - Lista dos 6 custom fields registrados na sub-account
 *   - Webhooks registrados
 *   - Status do Custom Menu (US5)
 *   - Últimas 10 entradas do `integration_sync_log`
 *
 * NUNCA renderiza `access_token`/`refresh_token`/`credentials_enc`.
 */

type GhlPanelStatus = 'not_connected' | 'connected' | 'token_expired' | 'disconnected'

interface GhlOAuthPanelProps {
  tenantId: string
  role: TenantRole
  supabase: SupabaseClient<Database>
  /** Query string passada pelo callback OAuth (`?status=...&warnings=...`) */
  callbackStatus?: string
  callbackWarnings?: string[]
  /** Feature 010 (US1) — code de rejeição quando status='rejected'. */
  callbackCode?: string
}

export async function GhlOAuthPanel({
  tenantId,
  role,
  supabase,
  callbackStatus,
  callbackWarnings,
  callbackCode,
}: GhlOAuthPanelProps): Promise<JSX.Element> {
  const row = await getIntegrationConfig(supabase, tenantId, 'ghl')

  const status: GhlPanelStatus = !row
    ? 'not_connected'
    : row.enabled === false
      ? 'disconnected'
      : (((row as unknown as { status?: string }).status ??
          'connected') as GhlPanelStatus)

  const config = (row?.config ?? {}) as Partial<GhlConfigV2>
  const customFields = buildCustomFieldsListing(config.custom_field_ids ?? {})
  const webhooks = Object.entries(config.webhook_ids ?? {})
    .filter(([, id]) => Boolean(id))
    .map(([event, id]) => ({ event, id: String(id) }))

  // Detecta tenants em formato legacy Feature 002 (ainda têm
  // `operations_pat` em credentials_enc, sem `access_token`). Banner
  // pede Reconectar para migrar para OAuth 2.0.
  let isLegacyTenant = false
  if (row && (row as unknown as { status?: string }).status === 'connected') {
    try {
      await decryptCredentials(supabase, row, ghlOAuthCredentialsSchema)
    } catch {
      isLegacyTenant = true
    }
  }

  const syncLog = await listRecentSyncLog(supabase, tenantId, 10)
  const isAdmin = role === 'admin'

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Plug className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black tracking-tight text-slate-900">
              Homio
            </h1>
            {renderStatusBadge(status)}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            CRM e automação de marketing — sincronização bidirecional de contatos
            via OAuth 2.0.
          </p>
        </div>
      </div>

      {isLegacyTenant ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-[hsl(var(--warning)/0.1)] p-3 text-sm text-[hsl(var(--warning-foreground))]">
          <AlertTriangle className="h-4 w-4 mt-0.5" />
          <div>
            <p className="font-semibold">Reconexão necessária</p>
            <p className="text-xs mt-1">
              Sua conexão Homio está no formato antigo (proxy compartilhado).
              Reconecte para migrar para o OAuth 2.0 oficial — pacientes,
              atendimentos e custom fields são preservados.
            </p>
            {isAdmin ? (
              <Button asChild size="sm" className="mt-2" variant="default">
                <Link href="/api/oauth/ghl/authorize">Reconectar agora</Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {callbackStatus === 'connected' ? (
        <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success-bg p-3 text-sm text-success-text">
          <CheckCircle2 className="h-4 w-4 mt-0.5" />
          <div>
            <p className="font-semibold">Integração conectada com sucesso</p>
            {callbackWarnings && callbackWarnings.length > 0 ? (
              <p className="text-xs mt-1">
                Avisos: {callbackWarnings.join(', ')}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {callbackStatus === 'rejected' && callbackCode ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5" />
          <div>
            <p className="font-semibold">Conexão rejeitada</p>
            <p className="text-xs mt-1">
              {callbackCode === 'GHL_TENANT_ALREADY_CONNECTED'
                ? 'Esta clínica já está conectada a outra conta Homio. Desconecte primeiro.'
                : callbackCode === 'GHL_LOCATION_ALREADY_BOUND'
                  ? 'Esta conta Homio já está vinculada a outra clínica no Prontool. Cada clínica pode usar apenas uma sub-account.'
                  : 'Não foi possível concluir a conexão. Tente novamente.'}
            </p>
          </div>
        </div>
      ) : null}

      {status === 'not_connected' || status === 'disconnected' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Conectar ao Homio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              Ao conectar, a sub-account escolhida no Homio receberá os custom
              fields clínicos do Prontool (CPF, plano, profissional, último
              atendimento, diagnósticos, alergias) e os webhooks de contato.
            </p>
            <p className="rounded-md border border-warning/30 bg-[hsl(var(--warning)/0.1)] p-2 text-xs text-[hsl(var(--warning-foreground))]">
              Cada clínica pode ser conectada a apenas uma conta Homio.
              Antes de conectar, certifique-se de que a sub-account não está
              vinculada a outra clínica do Prontool.
            </p>
            {isAdmin ? (
              <Button asChild>
                <Link href="/api/oauth/ghl/authorize">Conectar ao Homio</Link>
              </Button>
            ) : (
              <p className="text-xs text-slate-500">
                Somente um administrador pode conectar a integração.
              </p>
            )}
          </CardContent>
        </Card>
      ) : status === 'token_expired' ? (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Token expirado — reconecte para continuar sincronizando
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              O Prontool não conseguiu renovar o token. Reconecte para gerar um
              novo par de credenciais sem perder os custom fields nem os
              webhooks já registrados na sub-account.
            </p>
            {isAdmin ? (
              <Button asChild variant="default">
                <Link href="/api/oauth/ghl/authorize">
                  <RefreshCw className="h-4 w-4 mr-2" /> Reconectar
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Conexão ativa</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Sub-account">{config.sub_account_name ?? '—'}</Field>
            <Field label="Location ID">{config.location_id ?? '—'}</Field>
            <Field label="Conectado em">
              {(row as unknown as { connected_at?: string })?.connected_at
                ? new Date(
                    (row as unknown as { connected_at: string }).connected_at,
                  ).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                : '—'}
            </Field>
            {isAdmin ? (
              <div className="flex gap-2 pt-2">
                <Button asChild variant="outline">
                  <Link href="/api/oauth/ghl/authorize">
                    <RefreshCw className="h-4 w-4 mr-2" /> Reconectar
                  </Link>
                </Button>
                <GhlDisconnectButton />
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Somente um administrador pode reconectar ou desconectar.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {status === 'connected' || status === 'token_expired' ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                Custom fields registrados ({customFields.length}/6)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {customFields.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Nenhum field registrado ainda. O setup roda em segundo plano
                  após a conexão; recarregue em alguns segundos.
                </p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {customFields.map((f) => (
                    <li key={f.slug} className="flex justify-between gap-3">
                      <span className="font-medium text-slate-700">{f.name}</span>
                      <code className="text-slate-500">{f.id}</code>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                Webhooks registrados ({webhooks.length}/3)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {webhooks.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Nenhum webhook registrado ainda.
                </p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {webhooks.map((w) => (
                    <li key={w.event} className="flex justify-between gap-3">
                      <span className="font-medium text-slate-700">{w.event}</span>
                      <code className="text-slate-500">{w.id}</code>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Custom Menu (SSO)</CardTitle>
            </CardHeader>
            <CardContent>
              {renderMenuStatus(config.menu_status ?? 'not_attempted')}
            </CardContent>
          </Card>
        </>
      ) : null}

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Últimas operações de sincronização</CardTitle>
        </CardHeader>
        <CardContent>
          {syncLog.length === 0 ? (
            <p className="text-xs text-slate-500">
              Nenhuma operação registrada ainda.
            </p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {syncLog.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3"
                >
                  <span
                    className={
                      entry.status === 'success'
                        ? 'inline-flex items-center gap-1 text-success-strong'
                        : 'inline-flex items-center gap-1 text-destructive'
                    }
                  >
                    {entry.status === 'success' ? '●' : '✕'} {entry.kind}
                  </span>
                  <span className="text-slate-500 ml-auto whitespace-nowrap">
                    {new Date(entry.occurred_at).toLocaleString('pt-BR', {
                      timeZone: 'America/Sao_Paulo',
                    })}
                  </span>
                  {entry.error_code ? (
                    <span className="text-destructive truncate max-w-[12rem]">
                      {entry.error_code}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function buildCustomFieldsListing(
  ids: GhlConfigV2['custom_field_ids'],
): Array<{ slug: GhlCustomFieldSlug; name: string; id: string; alias: string }> {
  const out: Array<{ slug: GhlCustomFieldSlug; name: string; id: string; alias: string }> = []
  for (const slug of GHL_CUSTOM_FIELD_SLUGS) {
    const entry = ids?.[slug]
    if (entry?.id) {
      out.push({
        slug,
        name: GHL_CUSTOM_FIELD_DEFINITIONS[slug].name,
        id: entry.id,
        alias: entry.alias,
      })
    }
  }
  return out
}

function renderStatusBadge(status: GhlPanelStatus): JSX.Element {
  switch (status) {
    case 'connected':
      return <Badge variant="success">Conectado</Badge>
    case 'token_expired':
      return <Badge variant="secondary">Token expirado</Badge>
    case 'disconnected':
      return <Badge variant="secondary">Desconectado</Badge>
    case 'not_connected':
    default:
      return <Badge variant="secondary">Não conectado</Badge>
  }
}

function renderMenuStatus(
  menuStatus: 'registered' | 'unsupported' | 'failed' | 'not_attempted',
): JSX.Element {
  switch (menuStatus) {
    case 'registered':
      return (
        <p className="text-xs text-success-strong">
          ✓ Menu registrado na sub-account. O usuário Homio pode abrir o Prontool
          direto pelo menu da sub-account.
        </p>
      )
    case 'unsupported':
      return (
        <p className="text-xs text-[hsl(var(--warning-foreground))]">
          A API atual do Homio não suportou o registro automático do Custom Menu.
          Configure manualmente apontando para <code>/api/sso/ghl</code>.
        </p>
      )
    case 'failed':
      return (
        <p className="text-xs text-destructive">
          O registro do Custom Menu falhou. Reconecte ou registre manualmente.
        </p>
      )
    case 'not_attempted':
    default:
      return (
        <p className="text-xs text-slate-500">Custom menu ainda não foi configurado.</p>
      )
  }
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono text-slate-700">{children}</span>
    </div>
  )
}

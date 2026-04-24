'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export interface JsonSchema {
  type: string
  properties: Record<string, { type?: string; minLength?: number; maxLength?: number; pattern?: string }>
  required: string[]
}

export interface ProviderFormProps {
  provider: string
  connected: boolean
  configSchema: JsonSchema
  credentialsSchema: JsonSchema
  currentConfig: Record<string, unknown>
}

export function ProviderForm({
  provider,
  connected: initialConnected,
  currentConfig,
}: ProviderFormProps) {
  const router = useRouter()
  const [schemas, setSchemas] = useState<{
    config: JsonSchema
    credentials: JsonSchema
  } | null>(null)
  const [config, setConfig] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(currentConfig ?? {}).map(([k, v]) => [k, String(v ?? '')]),
    ),
  )
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [connected, setConnected] = useState(initialConnected)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load schemas from the API (the route handler serializes Zod → JSON Schema).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await fetch(`/api/configuracoes/integracoes/${provider}`)
      if (!res.ok || cancelled) return
      const body = (await res.json()) as {
        config_schema?: JsonSchema
        credentials_schema?: JsonSchema
        config?: Record<string, unknown>
      }
      if (body.config_schema && body.credentials_schema) {
        setSchemas({ config: body.config_schema, credentials: body.credentials_schema })
      }
      if (body.config && !connected) {
        // edge case: row existed but we rendered as !connected. refresh.
        setConfig(
          Object.fromEntries(
            Object.entries(body.config).map(([k, v]) => [k, String(v ?? '')]),
          ),
        )
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider])

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (reason.trim().length < 3) {
      setError('Informe o motivo (≥ 3 caracteres) para registrar em auditoria.')
      return
    }
    setPending(true)
    try {
      const res = await fetch(`/api/configuracoes/integracoes/${provider}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          config,
          credentials,
          enabled: true,
          reason: reason.trim(),
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        connected?: boolean
        error?: { message?: string; issues?: unknown }
      }
      if (!res.ok || !body.connected) {
        setError(body.error?.message ?? 'Falha ao salvar configuração.')
        return
      }
      setConnected(true)
      setCredentials({})
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  async function onDisconnect() {
    const confirmReason = window.prompt('Motivo para desconectar (registro em auditoria):')
    if (!confirmReason || confirmReason.trim().length < 3) return
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/configuracoes/integracoes/${provider}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: confirmReason.trim() }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        connected?: boolean
        error?: { message?: string }
      }
      if (!res.ok) {
        setError(body.error?.message ?? 'Falha ao desconectar.')
        return
      }
      setConnected(false)
      setConfig({})
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  if (!schemas) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando formulário…
      </div>
    )
  }

  const configFields = Object.entries(schemas.config.properties)
  const credentialFields = Object.entries(schemas.credentials.properties)

  return (
    <form onSubmit={onSave} className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">
          Configuração
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {configFields.map(([key, schema]) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`cfg-${key}`}>{labelize(key)}</Label>
              <Input
                id={`cfg-${key}`}
                value={config[key] ?? ''}
                onChange={(e) => setConfig((prev) => ({ ...prev, [key]: e.target.value }))}
                maxLength={schema.maxLength ?? 200}
                required={schemas.config.required.includes(key)}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">
          Credenciais {connected ? <span className="text-slate-400">(digite para rotacionar)</span> : null}
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {credentialFields.map(([key, schema]) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`cred-${key}`}>{labelize(key)}</Label>
              <Input
                id={`cred-${key}`}
                type="password"
                value={credentials[key] ?? ''}
                onChange={(e) => setCredentials((prev) => ({ ...prev, [key]: e.target.value }))}
                maxLength={schema.maxLength ?? 256}
                autoComplete="off"
                required={!connected && schemas.credentials.required.includes(key)}
                placeholder={connected ? '••• (manter atual se em branco ainda não é suportado)' : ''}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-1.5">
        <Label htmlFor="reason">Motivo (auditoria)</Label>
        <Textarea
          id="reason"
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex.: conectando integração para o cliente X"
          required
        />
      </section>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <div className="flex items-center justify-between gap-2">
        {connected ? (
          <Button type="button" variant="destructive" onClick={onDisconnect} disabled={pending}>
            <Trash2 className="mr-2 h-4 w-4" />
            Desconectar
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvando…
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              {connected ? 'Reconfigurar' : 'Conectar'}
            </>
          )}
        </Button>
      </div>
    </form>
  )
}

function labelize(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bId\b/i, 'ID')
    .replace(/\bTuss\b/i, 'TUSS')
    .replace(/\bPat\b/i, 'PAT')
}

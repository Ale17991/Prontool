'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, FileText, FlaskConical, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import type { MemedConfigPublic } from '@/lib/core/integrations/memed/types'

/** Termo de responsabilidade da prescrição digital (exibido antes do aceite). */
const MEMED_TERMS: Array<{ title: string; body: string }> = [
  {
    title: '1. Profissional qualificado',
    body: 'As prescrições são emitidas exclusivamente por profissionais de saúde legalmente habilitados, com registro ativo no respectivo conselho de classe.',
  },
  {
    title: '2. Veracidade dos dados',
    body: 'A clínica é responsável pela exatidão dos dados cadastrais dos prescritores (CPF, conselho, UF e data de nascimento) e dos pacientes.',
  },
  {
    title: '3. Responsabilidade clínica',
    body: 'A responsabilidade pelo conteúdo clínico de cada prescrição (medicamentos, posologia, indicações) é exclusiva do profissional prescritor.',
  },
  {
    title: '4. Sigilo e proteção de dados',
    body: 'A clínica mantém as credenciais de integração em sigilo e trata os dados pessoais e de saúde dos pacientes conforme a LGPD.',
  },
  {
    title: '5. Validade legal em produção',
    body: 'Em ambiente de produção, as prescrições têm validade legal (assinatura digital via Memed). O uso indevido da ferramenta é de responsabilidade da clínica.',
  },
  {
    title: '6. Termos da Memed',
    body: 'A clínica declara aceitar os Termos de Uso e a Política de Privacidade da Memed. O descumprimento destes itens pode levar à revogação do acesso de produção pela Memed.',
  },
]

interface ApiError {
  error?: { code?: string; message?: string }
}

async function callApi(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as ApiError
      return { ok: false, message: data.error?.message ?? `Erro ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Erro de rede' }
  }
}

export function MemedConnectionForm({
  initialConfig,
}: {
  initialConfig: MemedConfigPublic | null
}): JSX.Element {
  const router = useRouter()
  const connected = Boolean(initialConfig?.connected)

  if (!connected) {
    return <ConnectCard onDone={() => router.refresh()} />
  }
  return <ConnectedPanel config={initialConfig!} onDone={() => router.refresh()} />
}

function ConnectCard({ onDone }: { onDone: () => void }): JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConnect() {
    setSubmitting(true)
    setError(null)
    const result = await callApi('/api/integracoes/memed', 'POST', {
      api_key: apiKey.trim(),
      secret_key: secretKey.trim(),
    })
    setSubmitting(false)
    if (!result.ok) {
      setError(result.message ?? 'Falha ao conectar')
      return
    }
    onDone()
  }

  const canSubmit = apiKey.trim().length > 0 && secretKey.trim().length > 0 && !submitting

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Conectar à Memed (homologação)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-600">
          Informe as chaves da Memed. Elas são cifradas no servidor e nunca aparecem no
          navegador, em logs ou em respostas de API.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="memed-api-key">API Key</Label>
          <Input
            id="memed-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="api-key da Memed"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="memed-secret-key">Secret Key</Label>
          <Input
            id="memed-secret-key"
            type="password"
            autoComplete="off"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            placeholder="secret-key da Memed"
          />
        </div>
        <p className="rounded-md border border-warning/30 bg-[hsl(var(--warning)/0.1)] p-2 text-xs text-[hsl(var(--warning-foreground))]">
          A conexão entra em <strong>modo homologação</strong> (sem validade legal). A
          ativação de produção é feita depois, com aceite do termo de responsabilidade.
        </p>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <Button onClick={handleConnect} disabled={!canSubmit}>
          {submitting ? 'Conectando…' : 'Conectar'}
        </Button>
      </CardContent>
    </Card>
  )
}

function ConnectedPanel({
  config,
  onDone,
}: {
  config: MemedConfigPublic
  onDone: () => void
}): JSX.Element {
  const [busy, setBusy] = useState<null | 'env' | 'terms' | 'disconnect'>(null)
  const [error, setError] = useState<string | null>(null)
  const [termsOpen, setTermsOpen] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const isProduction = config.environment === 'production'
  const hasTerms = Boolean(config.termsAcceptedAt)

  async function switchEnvironment(environment: 'staging' | 'production') {
    if (environment === config.environment) return
    setBusy('env')
    setError(null)
    const result = await callApi('/api/integracoes/memed', 'PATCH', { environment })
    setBusy(null)
    if (!result.ok) {
      setError(result.message ?? 'Falha ao alterar ambiente')
      return
    }
    onDone()
  }

  async function acceptTerms() {
    setBusy('terms')
    setError(null)
    const result = await callApi('/api/integracoes/memed/termo', 'POST')
    setBusy(null)
    if (!result.ok) {
      setError(result.message ?? 'Falha ao registrar o termo')
      return
    }
    setTermsOpen(false)
    onDone()
  }

  async function disconnect() {
    if (
      !window.confirm(
        'Desconectar a Memed? A clínica deixa de oferecer prescrição digital até reconectar. O histórico de prescrições é preservado.',
      )
    ) {
      return
    }
    setBusy('disconnect')
    setError(null)
    const result = await callApi('/api/integracoes/memed', 'DELETE')
    setBusy(null)
    if (!result.ok) {
      setError(result.message ?? 'Falha ao desconectar')
      return
    }
    onDone()
  }

  return (
    <div className="space-y-6">
      {!isProduction ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-[hsl(var(--warning)/0.1)] p-3 text-sm text-[hsl(var(--warning-foreground))]">
          <FlaskConical className="mt-0.5 h-4 w-4" />
          <div>
            <p className="font-semibold">Modo homologação — sem validade legal</p>
            <p className="mt-1 text-xs">
              As prescrições emitidas agora são de teste. Ative a produção (com aceite do
              termo) quando estiver pronto para emitir prescrições válidas.
            </p>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-success-strong" /> Conexão ativa
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-slate-500">Ambiente</span>
            {isProduction ? (
              <Badge variant="success">Produção</Badge>
            ) : (
              <Badge variant="secondary">Homologação</Badge>
            )}
          </div>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-slate-500">Termo de responsabilidade</span>
            <span className="font-mono text-slate-700">
              {config.termsAcceptedAt
                ? new Date(config.termsAcceptedAt).toLocaleString('pt-BR', {
                    timeZone: 'America/Sao_Paulo',
                  })
                : 'pendente'}
            </span>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="text-xs text-slate-500">Ambiente</Label>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={!isProduction ? 'default' : 'outline'}
                disabled={busy !== null}
                onClick={() => switchEnvironment('staging')}
              >
                Homologação
              </Button>
              <Button
                size="sm"
                variant={isProduction ? 'default' : 'outline'}
                disabled={busy !== null}
                onClick={() => switchEnvironment('production')}
              >
                Produção
              </Button>
            </div>
            {!hasTerms ? (
              <p className="text-xs text-slate-500">
                A produção exige o aceite do termo de responsabilidade.
              </p>
            ) : null}
          </div>

          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => {
              setAgreed(false)
              setTermsOpen(true)
            }}
            className="gap-2"
          >
            <FileText className="h-4 w-4" />
            {hasTerms ? 'Ver termo de responsabilidade' : 'Ver e aceitar termo de responsabilidade'}
          </Button>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <Separator />

          <div className="flex items-center gap-3">
            <Button variant="destructive" size="sm" disabled={busy !== null} onClick={disconnect}>
              {busy === 'disconnect' ? 'Desconectando…' : 'Desconectar'}
            </Button>
            <span className="text-xs text-slate-500">
              Mantém o histórico de prescrições; interrompe novas emissões.
            </span>
          </div>
        </CardContent>
      </Card>

      <Dialog open={termsOpen} onOpenChange={setTermsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" /> Termo de responsabilidade
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            Ao ativar a prescrição digital em produção, a clínica declara estar ciente e de acordo
            com os itens abaixo.
          </p>
          <div className="max-h-[45dvh] space-y-3 overflow-y-auto pr-1">
            {MEMED_TERMS.map((s) => (
              <div key={s.title}>
                <p className="text-sm font-semibold text-slate-800">{s.title}</p>
                <p className="text-xs text-slate-600">{s.body}</p>
              </div>
            ))}
          </div>
          {hasTerms ? (
            <p className="text-xs font-medium text-success-text">
              ✓ Termo aceito em{' '}
              {new Date(config.termsAcceptedAt!).toLocaleString('pt-BR', {
                timeZone: 'America/Sao_Paulo',
              })}
              .
            </p>
          ) : (
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5"
              />
              <span>Li e concordo com o termo de responsabilidade acima.</span>
            </label>
          )}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setTermsOpen(false)}>
              Fechar
            </Button>
            {!hasTerms ? (
              <Button
                size="sm"
                disabled={!agreed || busy !== null}
                onClick={acceptTerms}
                className="gap-2"
              >
                <ShieldCheck className="h-4 w-4" />
                {busy === 'terms' ? 'Registrando…' : 'Aceitar termo'}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

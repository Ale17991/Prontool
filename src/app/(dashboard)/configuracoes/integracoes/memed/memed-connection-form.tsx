'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, FileText, FlaskConical, ShieldCheck, Stethoscope } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import type { MemedConfigPublic } from '@/lib/core/integrations/memed/types'

/** Termo de responsabilidade (exibido antes de ativar). */
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
    body: 'A clínica trata os dados pessoais e de saúde dos pacientes conforme a LGPD.',
  },
  {
    title: '5. Validade legal em produção',
    body: 'Em ambiente de produção, as prescrições têm validade legal (assinatura digital via Memed). O uso indevido da ferramenta é de responsabilidade da clínica.',
  },
  {
    title: '6. Termos da Memed',
    body: 'A clínica declara aceitar os Termos de Uso e a Política de Privacidade da Memed. O descumprimento pode levar à revogação do acesso de produção pela Memed.',
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
  productionConfigured,
}: {
  initialConfig: MemedConfigPublic | null
  productionConfigured: boolean
}): JSX.Element {
  const router = useRouter()
  const active = Boolean(initialConfig?.connected)
  const onDone = () => router.refresh()
  return active ? (
    <ActivePanel config={initialConfig!} productionConfigured={productionConfigured} onDone={onDone} />
  ) : (
    <ActivateCard productionConfigured={productionConfigured} onDone={onDone} />
  )
}

function TermsBody(): JSX.Element {
  return (
    <div className="max-h-[45dvh] space-y-3 overflow-y-auto pr-1">
      {MEMED_TERMS.map((s) => (
        <div key={s.title}>
          <p className="text-sm font-semibold text-slate-800">{s.title}</p>
          <p className="text-xs text-slate-600">{s.body}</p>
        </div>
      ))}
    </div>
  )
}

function ActivateCard({
  productionConfigured,
  onDone,
}: {
  productionConfigured: boolean
  onDone: () => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [environment, setEnvironment] = useState<'staging' | 'production'>(
    productionConfigured ? 'production' : 'staging',
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function activate() {
    setSubmitting(true)
    setError(null)
    const result = await callApi('/api/integracoes/memed', 'POST', {
      environment,
      accept_terms: true,
    })
    setSubmitting(false)
    if (!result.ok) {
      setError(result.message ?? 'Falha ao ativar')
      return
    }
    setOpen(false)
    onDone()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Stethoscope className="h-4 w-4 text-primary" /> Ativar prescrição digital
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-600">
          A prescrição digital usa as credenciais da plataforma Clinni com a Memed — você não
          precisa de chave. Leia o termo de responsabilidade, confirme e ative.
        </p>
        <Button
          onClick={() => {
            setAgreed(false)
            setEnvironment(productionConfigured ? 'production' : 'staging')
            setOpen(true)
          }}
          className="gap-2"
        >
          <FileText className="h-4 w-4" /> Ler termo e ativar
        </Button>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" /> Termo de responsabilidade
              </DialogTitle>
            </DialogHeader>
            <TermsBody />

            <div className="space-y-2">
              <Label className="text-xs text-slate-500">Ambiente</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={environment === 'staging' ? 'default' : 'outline'}
                  onClick={() => setEnvironment('staging')}
                >
                  Homologação (teste)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={environment === 'production' ? 'default' : 'outline'}
                  disabled={!productionConfigured}
                  onClick={() => setEnvironment('production')}
                >
                  Produção
                </Button>
              </div>
              {!productionConfigured ? (
                <p className="text-[11px] text-slate-400">
                  Produção indisponível — a plataforma ainda não tem as chaves de produção
                  configuradas.
                </p>
              ) : null}
            </div>

            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5"
              />
              <span>Li e concordo com o termo de responsabilidade acima.</span>
            </label>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button size="sm" disabled={!agreed || submitting} onClick={activate} className="gap-2">
                <CheckCircle2 className="h-4 w-4" />
                {submitting ? 'Ativando…' : 'Ativar prescrição digital'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

function ActivePanel({
  config,
  productionConfigured,
  onDone,
}: {
  config: MemedConfigPublic
  productionConfigured: boolean
  onDone: () => void
}): JSX.Element {
  const [busy, setBusy] = useState<null | 'env' | 'deactivate'>(null)
  const [error, setError] = useState<string | null>(null)
  const [termsOpen, setTermsOpen] = useState(false)
  const isProduction = config.environment === 'production'

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

  async function deactivate() {
    if (
      !window.confirm(
        'Desativar a prescrição digital? A clínica deixa de prescrever até reativar. O histórico é preservado.',
      )
    ) {
      return
    }
    setBusy('deactivate')
    setError(null)
    const result = await callApi('/api/integracoes/memed', 'DELETE')
    setBusy(null)
    if (!result.ok) {
      setError(result.message ?? 'Falha ao desativar')
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
              As prescrições emitidas agora são de teste. Ative a produção quando estiver pronto
              para emitir prescrições válidas.
            </p>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-success-strong" /> Prescrição digital ativa
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
            <span className="text-slate-500">Termo aceito em</span>
            <span className="font-mono text-slate-700">
              {config.termsAcceptedAt
                ? new Date(config.termsAcceptedAt).toLocaleString('pt-BR', {
                    timeZone: 'America/Sao_Paulo',
                  })
                : '—'}
            </span>
          </div>

          <Button variant="outline" size="sm" onClick={() => setTermsOpen(true)} className="gap-2">
            <FileText className="h-4 w-4" /> Ver termo de responsabilidade
          </Button>

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
                disabled={busy !== null || !productionConfigured}
                onClick={() => switchEnvironment('production')}
              >
                Produção
              </Button>
            </div>
            {!productionConfigured ? (
              <p className="text-[11px] text-slate-400">
                Produção indisponível — chaves de produção não configuradas na plataforma.
              </p>
            ) : null}
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <Separator />

          <div className="flex items-center gap-3">
            <Button variant="destructive" size="sm" disabled={busy !== null} onClick={deactivate}>
              {busy === 'deactivate' ? 'Desativando…' : 'Desativar'}
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
          <TermsBody />
          <p className="text-xs font-medium text-success-text">
            ✓ Aceito em{' '}
            {config.termsAcceptedAt
              ? new Date(config.termsAcceptedAt).toLocaleString('pt-BR', {
                  timeZone: 'America/Sao_Paulo',
                })
              : '—'}
            .
          </p>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setTermsOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

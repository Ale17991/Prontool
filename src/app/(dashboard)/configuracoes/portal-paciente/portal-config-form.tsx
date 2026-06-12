'use client'

import { useMemo, useState, useTransition } from 'react'
import { Copy, ExternalLink, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type {
  MetricSetting,
  PatientPortalConfig,
} from '@/lib/core/patient-portal/portal-config'
import { createMetricAction, savePortalConfigAction, setMetricEnabledAction } from './actions'

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{2,31}$/

interface Props {
  initialConfig: PatientPortalConfig
  initialMetrics: MetricSetting[]
  baseUrl: string
}

export function PortalConfigForm({ initialConfig, initialMetrics, baseUrl }: Props) {
  const [enabled, setEnabled] = useState(initialConfig.patientPortalEnabled)
  const [slug, setSlug] = useState(initialConfig.publicBookingSlug)
  const [metrics, setMetrics] = useState(initialMetrics)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; message: string } | null>(
    null,
  )
  const [pending, startTransition] = useTransition()

  // Cadastro de métrica custom.
  const emptyNew = { label: '', unit: '', min: '', max: '' }
  const [newMetric, setNewMetric] = useState(emptyNew)

  const newMetricError = useMemo(() => {
    const { label, unit, min, max } = newMetric
    if (!label && !unit && !min && !max) return null // form vazio, sem erro
    if (label.trim().length < 2) return 'Informe um nome (mín. 2 caracteres).'
    if (unit.trim().length < 1) return 'Informe a unidade (ex.: mg/dL).'
    const nMin = Number(min)
    const nMax = Number(max)
    if (!Number.isFinite(nMin) || !Number.isFinite(nMax)) return 'Faixa plausível inválida.'
    if (nMax <= nMin) return 'O máximo deve ser maior que o mínimo.'
    return null
  }, [newMetric])

  const canAddMetric =
    newMetric.label.trim().length >= 2 &&
    newMetric.unit.trim().length >= 1 &&
    newMetric.min !== '' &&
    newMetric.max !== '' &&
    newMetricError === null

  function addMetric() {
    if (!canAddMetric) return
    setFeedback(null)
    startTransition(async () => {
      const res = await createMetricAction({
        label: newMetric.label.trim(),
        unit: newMetric.unit.trim(),
        minPlausible: Number(newMetric.min),
        maxPlausible: Number(newMetric.max),
      })
      if (res.ok && res.metric) {
        setMetrics((prev) => [...prev, res.metric!])
        setNewMetric(emptyNew)
        setFeedback({ kind: 'ok', message: `Métrica "${res.metric.label}" cadastrada.` })
      } else {
        setFeedback({ kind: 'error', message: res.error ?? 'Erro ao cadastrar métrica.' })
      }
    })
  }

  const slugError = useMemo(() => {
    if (slug === null || slug === '') {
      return enabled ? 'Defina um endereço para habilitar o portal.' : null
    }
    return SLUG_REGEX.test(slug)
      ? null
      : 'Use 3-32 caracteres: letras minúsculas, dígitos e hífens. Comece com letra/dígito.'
  }, [slug, enabled])

  const publicUrl = slug ? `${baseUrl}/paciente/${slug}` : null

  function saveConfig() {
    setFeedback(null)
    startTransition(async () => {
      const res = await savePortalConfigAction({
        patientPortalEnabled: enabled,
        publicBookingSlug: slug,
      })
      if (res.ok) setFeedback({ kind: 'ok', message: 'Configuração salva.' })
      else setFeedback({ kind: 'error', message: res.error ?? 'Erro ao salvar.' })
    })
  }

  function toggleMetric(metricType: string, next: boolean) {
    // Otimista; reverte em erro.
    setMetrics((prev) =>
      prev.map((m) => (m.metricType === metricType ? { ...m, enabled: next } : m)),
    )
    startTransition(async () => {
      const res = await setMetricEnabledAction(metricType, next)
      if (!res.ok) {
        setMetrics((prev) =>
          prev.map((m) => (m.metricType === metricType ? { ...m, enabled: !next } : m)),
        )
        setFeedback({ kind: 'error', message: res.error ?? 'Erro ao atualizar métrica.' })
      } else {
        setFeedback({ kind: 'ok', message: 'Métrica atualizada.' })
      }
    })
  }

  async function copyUrl() {
    if (!publicUrl) return
    try {
      await navigator.clipboard.writeText(publicUrl)
      setFeedback({ kind: 'ok', message: 'Link copiado.' })
    } catch {
      setFeedback({ kind: 'error', message: 'Falha ao copiar.' })
    }
  }

  return (
    <div className="space-y-6">
      {/* Card 1: liga/desliga + endereço */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configurações gerais</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-2 focus:ring-primary/30"
            />
            <span>Habilitar o portal do paciente</span>
          </label>

          <div className="space-y-1.5">
            <Label htmlFor="slug">Endereço do portal</Label>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-slate-50 px-2 py-2 text-xs text-slate-500">
                {baseUrl}/paciente/
              </span>
              <Input
                id="slug"
                value={slug ?? ''}
                onChange={(e) => setSlug(e.target.value.trim().toLowerCase() || null)}
                placeholder="minha-clinica"
                className={cn('flex-1', slugError && 'border-destructive/60')}
                maxLength={32}
              />
            </div>
            <p className="text-[11px] text-slate-500">
              É o mesmo endereço usado no agendamento online — define a identidade pública da
              clínica.
            </p>
            {slugError ? <p className="text-xs text-destructive">{slugError}</p> : null}
            {publicUrl ? (
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={copyUrl}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  <Copy className="h-3 w-3" /> Copiar link
                </button>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-link hover:bg-slate-50 hover:text-link-hover"
                >
                  <ExternalLink className="h-3 w-3" /> Abrir portal
                </a>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              {feedback ? (
                <p
                  className={cn(
                    'text-xs font-medium',
                    feedback.kind === 'ok' ? 'text-success-strong' : 'text-destructive',
                  )}
                >
                  {feedback.message}
                </p>
              ) : null}
            </div>
            <Button onClick={saveConfig} disabled={pending || !!slugError}>
              {pending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
              Salvar configurações
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Card 2: métricas visíveis */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Métricas exibidas ao paciente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-slate-500">
            Escolha quais métricas metabólicas a equipe registra e o paciente acompanha. Desligar
            uma métrica esconde-a do portal e da tela de registro.
          </p>
          {metrics.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma métrica no catálogo.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {metrics.map((m) => (
                <li key={m.metricType} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {m.label}
                      {m.tenantId ? (
                        <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                          personalizada
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Unidade: {m.unit} · faixa plausível {m.minPlausible}–{m.maxPlausible}
                    </p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
                    <input
                      type="checkbox"
                      checked={m.enabled}
                      disabled={pending}
                      onChange={(e) => toggleMetric(m.metricType, e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-2 focus:ring-primary/30"
                    />
                    {m.enabled ? 'Visível' : 'Oculta'}
                  </label>
                </li>
              ))}
            </ul>
          )}

          {/* Cadastrar nova métrica personalizada */}
          <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-3">
            <p className="mb-2 text-xs font-semibold text-slate-600">Cadastrar nova métrica</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
              <div className="space-y-1">
                <Label htmlFor="new-metric-label" className="text-[11px]">
                  Nome
                </Label>
                <Input
                  id="new-metric-label"
                  value={newMetric.label}
                  maxLength={80}
                  placeholder="Ex.: Glicemia pós-prandial"
                  onChange={(e) => setNewMetric((s) => ({ ...s, label: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-metric-unit" className="text-[11px]">
                  Unidade
                </Label>
                <Input
                  id="new-metric-unit"
                  value={newMetric.unit}
                  maxLength={16}
                  placeholder="mg/dL"
                  className="sm:w-24"
                  onChange={(e) => setNewMetric((s) => ({ ...s, unit: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-metric-min" className="text-[11px]">
                  Mín. plausível
                </Label>
                <Input
                  id="new-metric-min"
                  type="number"
                  value={newMetric.min}
                  placeholder="20"
                  className="sm:w-24"
                  onChange={(e) => setNewMetric((s) => ({ ...s, min: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-metric-max" className="text-[11px]">
                  Máx. plausível
                </Label>
                <Input
                  id="new-metric-max"
                  type="number"
                  value={newMetric.max}
                  placeholder="1000"
                  className="sm:w-24"
                  onChange={(e) => setNewMetric((s) => ({ ...s, max: e.target.value }))}
                />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-[11px] text-slate-500">
                {newMetricError ? (
                  <span className="text-destructive">{newMetricError}</span>
                ) : (
                  'A faixa plausível barra valores impossíveis (typos) — não é faixa de normalidade.'
                )}
              </p>
              <Button size="sm" onClick={addMetric} disabled={pending || !canAddMetric}>
                {pending ? (
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="mr-1 h-3 w-3" />
                )}
                Adicionar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

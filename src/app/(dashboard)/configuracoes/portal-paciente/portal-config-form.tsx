'use client'

import { useMemo, useState, useTransition } from 'react'
import { Copy, ExternalLink, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { MetricSetting, PatientPortalConfig } from '@/lib/core/patient-portal/portal-config'
import {
  buildPortalTheme,
  isValidHexColor,
  PORTAL_PALETTE_ERROR_MESSAGE,
  validatePortalPalette,
} from '@/lib/core/patient-portal/theme'
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
  const [welcomeText, setWelcomeText] = useState(initialConfig.welcomeText ?? '')
  const [brandColor, setBrandColor] = useState(initialConfig.brandColor)
  const [surfaceColor, setSurfaceColor] = useState(initialConfig.surfaceColor)
  const [metrics, setMetrics] = useState(initialMetrics)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null)
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

  // O mesmo validador do motor de tema — não uma cópia da regra. Se a tela
  // aceitasse o que o portal recusa, a clínica salvaria uma paleta e abriria o
  // portal na paleta padrão sem entender por quê.
  const paletteError = useMemo(() => {
    if (!brandColor || !surfaceColor) return null
    const problem = validatePortalPalette({ brand: brandColor, surface: surfaceColor })
    return problem ? PORTAL_PALETTE_ERROR_MESSAGE[problem] : null
  }, [brandColor, surfaceColor])

  const publicUrl = slug ? `${baseUrl}/paciente/${slug}` : null

  function saveConfig() {
    setFeedback(null)
    startTransition(async () => {
      const res = await savePortalConfigAction({
        patientPortalEnabled: enabled,
        publicBookingSlug: slug,
        welcomeText,
        brandColor,
        surfaceColor,
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
              É o mesmo endereço usado no agendamento online. Define a identidade pública da
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

          <div className="space-y-1.5">
            <Label htmlFor="welcome_text">Recado de boas-vindas (opcional)</Label>
            <textarea
              id="welcome_text"
              value={welcomeText}
              onChange={(e) => setWelcomeText(e.target.value.slice(0, 1000))}
              rows={3}
              maxLength={1000}
              placeholder="Ex.: Que bom ter você por aqui! Qualquer dúvida, fale com a recepção."
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <p className="text-[11px] text-slate-500">
              Aparece na tela inicial do portal <strong>somente</strong> quando o paciente ainda não
              tem metas nem checklist de hábitos. É o que evita que ele veja uma tela vazia. Quem
              já tem metas não vê este texto. {welcomeText.length}/1000 caracteres.
            </p>
          </div>

          <BrandColorFields
            brandColor={brandColor}
            surfaceColor={surfaceColor}
            error={paletteError}
            onChange={(next) => {
              setBrandColor(next.brandColor)
              setSurfaceColor(next.surfaceColor)
            }}
          />

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
            <Button onClick={saveConfig} disabled={pending || !!slugError || !!paletteError}>
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
                  'A faixa plausível barra valores impossíveis (typos). Não é faixa de normalidade.'
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

/**
 * Feature 058 — a marca da clínica no portal do paciente.
 *
 * DUAS cores, e só duas: o destaque e o fundo. Tudo o mais — texto, cartão,
 * borda, e a cor que vai SOBRE o destaque — é derivado pelo motor de tema. Não
 * existe campo para escolher cor de texto, e isso é o que torna impossível
 * salvar um portal ilegível: contraste de leitura é invariante, não preferência.
 *
 * A PRÉVIA É O PRÓPRIO MOTOR. Ela não recria a aparência do portal com valores
 * parecidos — chama `buildPortalTheme` e aplica as variáveis num wrapper, que é
 * exatamente o que o layout do portal faz. Uma prévia que reimplementa a
 * derivação é uma segunda verdade sobre a mesma cor, e o dia em que as duas
 * divergirem a clínica escolhe uma coisa e o paciente vê outra.
 *
 * "Voltar ao padrão" apaga as DUAS de uma vez, porque personalização parcial não
 * existe: uma cor sozinha cai no padrão de qualquer jeito, e deixar uma gravada
 * daria a impressão de que ela está valendo.
 */
function BrandColorFields({
  brandColor,
  surfaceColor,
  error,
  onChange,
}: {
  brandColor: string | null
  surfaceColor: string | null
  error: string | null
  onChange: (next: { brandColor: string | null; surfaceColor: string | null }) => void
}) {
  // Valores de trabalho para os seletores. O `<input type="color">` não sabe
  // representar "nenhuma cor", então quando a clínica ainda não escolheu ele
  // mostra a cor do produto — sem que isso signifique que ela está gravada.
  const brand = brandColor ?? '#003883'
  const surface = surfaceColor ?? '#f7f8fa'
  const customized = brandColor !== null || surfaceColor !== null

  const theme =
    isValidHexColor(brand) && isValidHexColor(surface)
      ? buildPortalTheme({ brand, surface })
      : null

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
      <div>
        <p className="text-sm font-semibold text-foreground">Cores do portal</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Valem <strong>somente</strong> na área do paciente — as telas da equipe seguem na paleta
          do sistema. O texto e as bordas são calculados a partir das suas cores, para a leitura
          continuar confortável em qualquer combinação.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ColorField
          id="portal-brand-color"
          label="Cor de destaque"
          hint="Botões, ícones das áreas e gráficos."
          value={brand}
          onChange={(v) => onChange({ brandColor: v, surfaceColor })}
        />
        <ColorField
          id="portal-surface-color"
          label="Cor de fundo"
          hint="O fundo das telas. Pode ser clara ou escura."
          value={surface}
          onChange={(v) => onChange({ brandColor, surfaceColor: v })}
        />
      </div>

      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}

      {theme && !error ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Prévia
          </p>
          <div
            className="rounded-xl border p-4"
            style={{
              ...(theme.vars as Record<string, string>),
              background: 'hsl(var(--background))',
              borderColor: 'hsl(var(--border))',
            }}
          >
            <div
              className="rounded-lg border p-3"
              style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
            >
              <p className="text-sm font-bold" style={{ color: 'hsl(var(--foreground))' }}>
                Olá, Maria
              </p>
              <p className="mt-0.5 text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Acompanhe sua evolução de saúde.
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <span
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{
                    background: 'hsl(var(--accent))',
                    color: 'hsl(var(--accent-foreground))',
                  }}
                >
                  <Plus className="h-4 w-4" />
                </span>
                <span
                  className="rounded-md px-2.5 py-1 text-xs font-semibold"
                  style={{
                    background: 'hsl(var(--primary))',
                    color: 'hsl(var(--primary-foreground))',
                  }}
                >
                  Ver minhas metas
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {customized ? (
        <button
          type="button"
          onClick={() => onChange({ brandColor: null, surfaceColor: null })}
          className="text-[11px] font-semibold text-link underline-offset-2 hover:underline"
        >
          Voltar às cores padrão
        </button>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Esta clínica ainda usa as cores padrão. Escolha as duas cores acima para personalizar.
        </p>
      )}
    </div>
  )
}

function ColorField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[11px]">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-border bg-card p-1"
        />
        {/* O campo de texto existe porque marca tem código: quem recebeu
            "#EE4B00" do designer precisa digitar, não caçar no seletor. */}
        <Input
          value={value}
          onChange={(e) => {
            const v = e.target.value.trim().toLowerCase()
            if (isValidHexColor(v)) onChange(v)
          }}
          maxLength={7}
          spellCheck={false}
          className="font-mono text-xs uppercase"
          aria-label={`${label} em hexadecimal`}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  )
}

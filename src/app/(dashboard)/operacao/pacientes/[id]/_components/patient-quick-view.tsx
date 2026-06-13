'use client'

import {
  Calendar,
  Heart,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  Printer,
  ShieldAlert,
  Stethoscope,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import type {
  QuickViewSnapshot,
  SheetKind,
} from '@/lib/core/patient-timeline'
import { QuickViewAllergiesCard } from './quick-view-allergies-card'
import { PatientTagsCard } from '@/components/patient-tags/patient-tags-card'

interface Props {
  patientId: string
  snapshot: QuickViewSnapshot
  onOpenSheet: (sheet: SheetKind) => void
  onSwitchToCadastro: () => void
  onPrint: () => void
  /** Ver valores monetários (recepção não). */
  canViewFinancialValues: boolean
}

function bmiClass(bmi: number | null): {
  label: string
  className: string
} | null {
  if (bmi === null) return null
  if (bmi < 18.5)
    return { label: 'Abaixo', className: 'bg-info-bg text-info-text' }
  if (bmi < 25)
    return { label: 'Normal', className: 'bg-success-bg text-success-text' }
  if (bmi < 30)
    return {
      label: 'Sobrepeso',
      className:
        'bg-[hsl(var(--warning)/0.2)] text-[hsl(var(--warning-foreground))]',
    }
  return {
    label: 'Obeso',
    className: 'bg-[hsl(var(--alert)/0.15)] text-[hsl(var(--alert))]',
  }
}

export function PatientQuickView({
  patientId,
  snapshot,
  onOpenSheet,
  onSwitchToCadastro,
  onPrint,
  canViewFinancialValues,
}: Props) {
  const { identity, contact, plan, allergies, diagnoses, lastVital, financial, permissions } =
    snapshot

  if (identity.isAnonymized) {
    return (
      <Card className="border-warning/30 bg-[hsl(var(--warning)/0.1)]">
        <CardContent className="space-y-3 p-4 text-sm">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div>
              <p className="font-bold text-[hsl(var(--warning-foreground))]">
                Paciente anonimizado por LGPD
              </p>
              <p className="text-xs text-[hsl(var(--warning-foreground))]">
                PII removida. Histórico financeiro preservado.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  const initial = (identity.fullName || '?').charAt(0).toUpperCase()

  return (
    <div className="space-y-3">
      {/* Identidade */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-black text-white">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-black text-slate-900">
                {identity.fullName || '—'}
              </p>
              <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
                {identity.ageYears !== null
                  ? `${identity.ageYears} anos`
                  : 'Idade não informada'}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                CPF {identity.cpf || '—'}
              </p>
            </div>
            {permissions.canEditPatient ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={onSwitchToCadastro}
                aria-label="Editar dados cadastrais"
                title="Editar dados cadastrais"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
          {identity.birthDate ? (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <Calendar className="h-3 w-3" />
              {formatDate(identity.birthDate)}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Contato */}
      {(contact.phone || contact.email) && (
        <Card>
          <CardContent className="space-y-2 p-3 text-xs">
            {contact.phone ? (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 truncate">
                  <Phone className="h-3.5 w-3.5 text-slate-400" />
                  <span className="truncate">{contact.phone}</span>
                </div>
                {contact.whatsappUrl ? (
                  <a
                    href={contact.whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-7 items-center gap-1 rounded-md bg-green-600 px-2 text-[11px] font-bold text-white hover:bg-green-700"
                    title="Abrir WhatsApp"
                  >
                    <MessageCircle className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            ) : null}
            {contact.email ? (
              <div className="flex items-center gap-2 truncate">
                <Mail className="h-3.5 w-3.5 text-slate-400" />
                <span className="truncate">{contact.email}</span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* Plano de saúde */}
      {plan.name ? (
        <Card>
          <CardContent className="p-3 text-xs">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Plano de saúde
            </p>
            <p className="mt-1 font-bold text-slate-700">{plan.name}</p>
          </CardContent>
        </Card>
      ) : null}

      {/* Tags coloridas — gerenciamento inline */}
      <PatientTagsCard patientId={patientId} />

      {/* Alergias — gerenciamento inline (add/remove) */}
      <QuickViewAllergiesCard
        patientId={patientId}
        initial={allergies}
        canWrite={permissions.canCreateAllergy}
      />

      {/* Diagnósticos */}
      {diagnoses.length > 0 ? (
        <Card>
          <CardContent className="space-y-2 p-3">
            <div className="flex items-center gap-1.5">
              <Stethoscope className="h-3.5 w-3.5 text-info-text" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Diagnósticos ({diagnoses.length})
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {diagnoses.map((d) => (
                <span
                  key={d.id}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px]',
                    d.status === 'ativo'
                      ? 'bg-info-bg text-info-text font-semibold'
                      : 'bg-slate-100 text-slate-700',
                  )}
                  title={d.cid10Description}
                >
                  <span className="font-mono font-bold">{d.cid10Code}</span>
                  {d.status === 'em_acompanhamento' ? (
                    <span className="text-[8px] uppercase opacity-70">
                      acomp.
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Último sinal vital */}
      {lastVital ? (
        <Card>
          <CardContent className="space-y-2 p-3">
            <div className="flex items-center gap-1.5">
              <Heart className="h-3.5 w-3.5 text-rose-500" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Último vital
              </p>
              <p className="ml-auto text-[10px] text-slate-400">
                {formatDate(lastVital.measuredAt)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <VitalLine
                label="PA"
                value={
                  lastVital.systolicBp && lastVital.diastolicBp
                    ? `${lastVital.systolicBp}/${lastVital.diastolicBp}`
                    : '—'
                }
              />
              <VitalLine
                label="FC"
                value={lastVital.heartRate?.toString() ?? '—'}
              />
              <VitalLine
                label="Peso"
                value={
                  lastVital.weightGrams !== null
                    ? `${(lastVital.weightGrams / 1000).toFixed(1)}kg`
                    : '—'
                }
              />
              <VitalLine
                label="IMC"
                value={lastVital.bmi !== null ? lastVital.bmi.toFixed(1) : '—'}
                badge={bmiClass(lastVital.bmi)}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Financeiro — só com finance.view_values (recepção não vê valores). */}
      {canViewFinancialValues && (financial.receivedCents > 0 || financial.pendingCents > 0) ? (
        <Card>
          <CardContent className="space-y-1.5 p-3">
            <div className="flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5 text-success-strong" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Financeiro
              </p>
            </div>
            <FinLine label="Recebido" value={formatCurrency(financial.receivedCents)} accent="success" />
            <FinLine label="Pendente" value={formatCurrency(financial.pendingCents)} accent={financial.pendingCents > 0 ? 'warning' : 'neutral'} />
            {financial.lastPaidAt ? (
              <FinLine
                label="Última paga"
                value={formatDate(financial.lastPaidAt)}
                accent="neutral"
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Ações rápidas */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-1.5 p-3">
          {permissions.canCreateEvolution ? (
            <ActionButton
              label="Evolução"
              onClick={() => onOpenSheet('new-evolution')}
            />
          ) : null}
          {permissions.canCreateAnamnesis ? (
            <ActionButton
              label="Anamnese"
              onClick={() => onOpenSheet('new-anamnese')}
            />
          ) : null}
          {permissions.canCreateVital ? (
            <ActionButton
              label="Sinal vital"
              onClick={() => onOpenSheet('new-vital')}
            />
          ) : null}
          {permissions.canCreateDiagnosis ? (
            <ActionButton
              label="Diagnóstico"
              onClick={() => onOpenSheet('new-diagnosis')}
            />
          ) : null}
          {permissions.canCreateHistory ? (
            <ActionButton
              label="Antecedente"
              onClick={() => onOpenSheet('new-history')}
            />
          ) : null}
          {permissions.canCreateText ? (
            <ActionButton
              label="Nota"
              onClick={() => onOpenSheet('new-text')}
            />
          ) : null}
          {permissions.canUploadFile ? (
            <ActionButton
              label="Arquivo"
              onClick={() => onOpenSheet('upload-file')}
            />
          ) : null}
          {permissions.canPrint ? (
            <Button
              size="sm"
              variant="outline"
              className="col-span-2 mt-1 h-8 gap-1.5"
              onClick={onPrint}
            >
              <Printer className="h-3 w-3" />
              <span className="text-[11px] font-bold">Imprimir prontuário</span>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function VitalLine({
  label,
  value,
  badge,
}: {
  label: string
  value: string
  badge?: { label: string; className: string } | null
}) {
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
        {label}
      </p>
      <div className="flex items-center gap-1">
        <p className="font-bold text-slate-700">{value}</p>
        {badge ? (
          <span
            className={cn(
              'rounded px-1 py-0.5 text-[8px] font-bold uppercase',
              badge.className,
            )}
          >
            {badge.label}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function FinLine({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent: 'success' | 'warning' | 'neutral'
}) {
  const colorClass =
    accent === 'success'
      ? 'text-success-strong'
      : accent === 'warning'
        ? 'text-[hsl(var(--warning-foreground))]'
        : 'text-slate-600'
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-slate-500">{label}</span>
      <span className={cn('font-bold', colorClass)}>{value}</span>
    </div>
  )
}

function ActionButton({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-8 text-[11px] font-bold"
      onClick={onClick}
    >
      + {label}
    </Button>
  )
}

'use client'

import { useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import type { TenantRole } from '@/lib/db/types'
import { useAppointmentDetail } from './use-appointment-detail'
import { AppointmentDetailBody } from './appointment-detail-body'

/**
 * Sheet lateral que exibe o detalhe do atendimento. Aberto quando
 * `appointmentId` ≠ null. Estados:
 *   - loading: spinner centralizado
 *   - error:   mensagem + botão "Tentar novamente" (chama refetch)
 *   - ready:   `<AppointmentDetailBody />` com os dados
 *
 * IMPORTANTE: o painel **permanece aberto** após `refetch()` (FR-005).
 * O usuário fecha manualmente via X, ESC ou click-outside.
 *
 * `dirtyRef` e `pendingActionRef` (vindos do Host via props) são consultados
 * pelo Host antes de chamar `onOpenChange(false)` ou trocar `appointmentId`,
 * para acionar `window.confirm(...)` quando há trabalho a perder.
 */
interface Props {
  appointmentId: string | null
  role: TenantRole
  /** Disparado quando o Sheet quer fechar (ESC, X, click-outside).
   *  Host valida guards antes de propagar. */
  onOpenChange: (open: boolean) => void
  /** Refs do Host — filhos escrevem; Host lê. */
  dirtyRef: React.MutableRefObject<boolean>
  pendingActionRef: React.MutableRefObject<boolean>
}

export function AppointmentDetailPanel({
  appointmentId,
  role,
  onOpenChange,
  dirtyRef,
  pendingActionRef,
}: Props) {
  const { data, loading, error, refetch } = useAppointmentDetail(appointmentId)
  const open = appointmentId !== null
  const titleRef = useRef<HTMLDivElement>(null)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-[600px]">
        <SheetTitle className="sr-only">Atendimento</SheetTitle>
        <div ref={titleRef} className="p-6">
          {loading && !data ? (
            <div className="flex min-h-[50vh] items-center justify-center text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="ml-2 text-sm">Carregando atendimento…</span>
            </div>
          ) : error ? (
            <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm font-bold text-destructive">{error.message}</p>
              {error.code === 'HTTP_404' || error.code === 'NOT_FOUND' ? null : (
                <Button onClick={() => refetch()} variant="outline" size="sm">
                  Tentar novamente
                </Button>
              )}
            </div>
          ) : data ? (
            <AppointmentDetailBody
              data={data}
              role={role}
              refetch={refetch}
              onDirtyChange={(dirty) => {
                dirtyRef.current = dirty
              }}
              onPendingChange={(pending) => {
                pendingActionRef.current = pending
              }}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}

'use client'

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/**
 * Backlog 1/11 — aviso por paciente exibido como pop-up bloqueante ao abrir a
 * ficha. Abre no mount sempre que há `alertNote`; só libera a página após
 * fechar. Reaparece a cada carregamento (não persiste "lido").
 */
export function PatientAlertModal({ alertNote }: { alertNote: string | null }) {
  const [open, setOpen] = useState(Boolean(alertNote && alertNote.trim()))

  if (!alertNote || !alertNote.trim()) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[hsl(var(--warning-foreground))]">
            <AlertTriangle className="h-5 w-5" />
            Aviso deste paciente
          </DialogTitle>
        </DialogHeader>
        <p className="whitespace-pre-wrap rounded-md bg-[hsl(var(--warning)/0.12)] px-3 py-2 text-sm text-slate-800">
          {alertNote}
        </p>
        <DialogFooter>
          <Button type="button" onClick={() => setOpen(false)} className="w-full">
            Entendi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

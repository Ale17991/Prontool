'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'

/**
 * Wrapper client-side do Sheet usado pela interception route
 * `@modal/(.)[id]/page.tsx`. Abre por padrão (open=true) porque a
 * própria renderização da rota interceptada significa "modal está
 * aberto". Fechar = router.back() que dispara a "des-interceptação"
 * e devolve o usuário à lista exatamente como estava (scroll, filtros).
 *
 * `SheetTitle` é obrigatório por a11y do Radix Dialog; o título visual
 * vive no conteúdo, então escondemos com `sr-only`.
 */
export function SheetShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [open, setOpen] = useState(true)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      // Espera a animação de saída antes de navegar de volta. Sem isso
      // o Radix unmount antes do slide-out terminar.
      window.setTimeout(() => router.back(), 200)
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto p-0 sm:max-w-3xl"
      >
        <SheetTitle className="sr-only">Atendimento</SheetTitle>
        <div className="p-6">{children}</div>
      </SheetContent>
    </Sheet>
  )
}

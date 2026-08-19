import { LoadingSpinner } from '@/components/ui/loading-spinner'

/**
 * Fica no segmento `admin`, e não em cada página filha, porque `layout.tsx`
 * envolve o `loading.tsx` do MESMO segmento: o cabeçalho e a navegação do
 * painel continuam na tela enquanto o conteúdo carrega. Um spinner por página
 * não daria nada a mais e teria que ser lembrado a cada tela nova.
 */
export default function AdminLoading() {
  return <LoadingSpinner className="min-h-[40vh]" />
}

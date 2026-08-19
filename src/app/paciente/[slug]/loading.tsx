import { LoadingSpinner } from '@/components/ui/loading-spinner'

/**
 * Fica em `[slug]` para alcançar também a tela de LOGIN, e por ficar ABAIXO do
 * layout que aplica a paleta da clínica (058) o spinner já sai temado — o
 * `LoadingSpinner` fala em token, não em `slate-*`, então a espera tem a cor da
 * clínica em vez de reapresentar o cinza do produto no meio do portal dela.
 */
export default function PortalLoading() {
  return <LoadingSpinner />
}

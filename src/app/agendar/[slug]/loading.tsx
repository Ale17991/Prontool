import { LoadingSpinner } from '@/components/ui/loading-spinner'

/**
 * O agendamento público é a primeira tela que alguém de fora vê, e cada passo
 * (slug → horários → confirmar) consulta o banco antes de pintar. Sem limite de
 * suspensão, a navegação entre passos ficava com a tela anterior congelada — o
 * visitante clica de novo, e clicar de novo num fluxo de agendamento é o começo
 * de uma marcação duplicada.
 */
export default function AgendarLoading() {
  return <LoadingSpinner />
}

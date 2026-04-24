import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function RelatoriosIndexPage() {
  redirect('/analise/relatorios/mensal')
}

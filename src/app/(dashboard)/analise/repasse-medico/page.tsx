import { redirect } from 'next/navigation'
import { format } from 'date-fns'

export const dynamic = 'force-dynamic'

export default function RepasseMedicoIndexPage() {
  const month = format(new Date(), 'yyyy-MM')
  redirect(`/analise/repasse-medico/${month}`)
}

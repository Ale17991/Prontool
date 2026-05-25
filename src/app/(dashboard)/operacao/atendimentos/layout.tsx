/**
 * Layout que habilita o slot `@modal` para parallel/intercepting routes
 * em `/operacao/atendimentos`. O slot é preenchido por
 * `@modal/(.)[id]/page.tsx` quando o usuário clica num atendimento dentro
 * do app — abre o Sheet lateral sem desmontar a lista. Em qualquer outra
 * rota, `@modal/default.tsx` retorna null e o slot fica vazio.
 */
export default function AtendimentosLayout({
  children,
  modal,
}: {
  children: React.ReactNode
  modal: React.ReactNode
}) {
  return (
    <>
      {children}
      {modal}
    </>
  )
}

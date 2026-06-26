# Quickstart — Verificar os painéis /admin

## Pré-requisitos
- `pnpm supabase:reset` (aplica até `0165`) + `pnpm seed:demo`.
- `pnpm dev`. Logar como super-admin.

## Cenário A — Financeiro / MRR (US1)
1. Em `/admin/financeiro`, edite os preços de plano (ex.: Pro = R$ 199).
2. Confira que **MRR por plano** = nº de clínicas ativas no plano × preço, e o **MRR total** = soma.
3. Confira as contagens por status (trial/ativo/past_due/canceled), a lista de **trials a vencer** e de **inadimplentes**.
4. Edite um preço → o MRR recalcula; a mudança aparece no `audit_log`.

## Cenário B — Uso & risco (US2)
1. Em `/admin/uso`, veja por clínica: atendimentos no período, usuários ativos, última atividade.
2. Uma clínica sem atividade há **>14 dias** aparece marcada **em risco**; uma ativa não.
3. Ordenar por uso/risco reflete o critério.

## Cenário C — Auditoria global (US3)
1. Faça uma ação sensível (ex.: mudar plano de uma clínica, impersonar outra, mexer numa permissão).
2. Em `/admin/auditoria`, os eventos aparecem (ator, clínica, antes/depois, horário).
3. Filtrar por tipo (ex.: "impersonação") / clínica / ator / período reduz a lista corretamente.

## Cenário D — Saúde do sistema (US4)
1. Em `/admin/sistema`, veja alertas abertos, integrações falhando, contagem de DLQ e status de lembretes/crons.
2. Resolver um alerta (fora deste painel) e recarregar → some da lista.

## Cenário E — Segurança
1. Logado como usuário de clínica (não super-admin), tentar acessar `/admin/financeiro` etc. → bloqueado.

## Testes (alvo)
- unit: MRR (plano×preço, legado incluso, trial fora); flag de risco (>14d); mapeamento tipo→entity/field do feed.
- ⚠️ Rodar testes apaga o banco local; re-seedar com `pnpm seed:demo`.

# Quickstart — Feature 004 (Calendário de atendimentos)

**Branch**: `004-calendario-atendimentos`

## Pré-requisitos

- Node 20 LTS, pnpm
- Docker Desktop em execução (Supabase local roda em containers)
- Conta de admin/recepcionista no tenant de dev

## Setup

```bash
git fetch origin
git checkout 004-calendario-atendimentos

pnpm install                # nenhuma dep nova; só sincroniza
pnpm supabase start         # sobe Postgres local em :54321
pnpm supabase:reset         # aplica todas as migrations, incluindo 0053
pnpm supabase:gen-types     # regenera src/lib/db/generated/types.ts com duration_minutes
```

## Validação rápida — Calendário (US1)

```bash
pnpm dev                    # http://localhost:3000
```

1. Faça login (admin ou recepcionista).
2. Vá em `/operacao/atendimentos`. A aba **Lista** continua sendo o default.
3. Clique no botão **Calendário** no toolbar.
4. Verifique:
   - Grid 7 colunas (dom–sáb) × 16 linhas (07–22h).
   - Linha vermelha cruzando a coluna do dia atual na altura da hora corrente.
   - Atendimentos da semana corrente aparecem como blocos posicionados; cor azul para ativos, vermelho para estornados.
   - Cada bloco mostra "Paciente · Procedimento".
5. Clique em um bloco existente → vai para `/operacao/atendimentos/[id]`.
6. Clique em um slot vazio (ex.: terça 14:00) → vai para `/operacao/atendimentos/novo?at=...` com data/hora preenchida.
7. Use o botão **Hoje** e setas anterior/próxima de semana.
8. Abra o filtro de profissionais → selecione 1 deles → veja só os blocos dele.
9. Em mobile (DevTools < 640px), confirme que abre direto em **Dia** com setas dia anterior/próximo.

## Validação — Typeahead TUSS + "Ver em lista" (US2)

1. Vá em `/cadastros/procedimentos`.
2. No formulário de novo procedimento, abra o popover TUSS — descrição completa em até 2 linhas (já delivered antes desta feature).
3. Clique em **Ver em lista**:
   - Abre dialog com tabela: TUSS, Nome, Tabela (badge).
   - Paginação 20/página, busca por código ou nome funciona.
   - Clicar numa linha seleciona e fecha.
4. Repita os passos no formulário de **Novo atendimento** (`/operacao/atendimentos/novo`) e em **Nova etapa** dentro de `/operacao/pacientes/[id]`. Comportamento idêntico.

## Validação — Catálogo odonto (US4)

```bash
pnpm seed:tuss:audit-odonto
```

Saída esperada:

```
[tuss-odonto-audit] baixando ANS 202501 (~341 MB)…
[tuss-odonto-audit] parseando TUSS 22 - ... 5964 entradas
[tuss-odonto-audit] consultando tuss_codes locais…
[tuss-odonto-audit] === Reconciliação ===
  prefix 81: local=40   official=39   diff=+1
  prefix 82: local=111  official=105  diff=+6
  prefix 83: local=9    official=9    diff=0
  prefix 84: local=15   official=14   diff=+1
  prefix 85: local=138  official=137  diff=+1
  prefix 86: local=57   official=56   diff=+1
  prefix 87: local=10   official=10   diff=0
  prefix 88: local=0    official=0    diff=0  (esperado — Tabela 22 oficial não tem 88x)
[tuss-odonto-audit] total local: 380; total oficial: 370
[tuss-odonto-audit] 0 códigos odonto faltando vs fonte oficial.
```

## Validação — Botão Voltar (US3)

1. Abra `/operacao/atendimentos/[qualquer-id]` → veja botão **Voltar** claramente visível no topo.
2. Clique → vai para `/operacao/atendimentos`.
3. Repita em `/operacao/atendimentos/novo`.

## Testes automatizados

```bash
pnpm typecheck                # tsc --noEmit
pnpm test                     # vitest full suite
pnpm test:integration         # apenas integration (DB local)
pnpm test:contract            # contracts (DTO shapes)
pnpm lint:auth                # requireRole + adapter env guards
```

E2E (smoke) no Playwright (opcional em dev):

```bash
pnpm test:e2e -- calendar
```

## Troubleshooting

- **Calendário vazio mas há atendimentos na lista** → verifique `doctors` no querystring. Se `?doctors=...` estiver com IDs vazios, o servidor retorna []. Remova o param.
- **Linha vermelha não aparece** → confirme que a semana corrente está selecionada (botão "Hoje").
- **Bloco com altura zero** → atendimento sem `duration_minutes` deveria cair em 30 min via COALESCE; se não, regenere os tipos: `pnpm supabase:gen-types`.
- **Audit script trava no download** → conexão lenta; arquivo são 341 MB. Use `TUSS_OFFICIAL_ZIP=/path/local.zip pnpm seed:tuss:audit-odonto` para apontar arquivo já baixado.

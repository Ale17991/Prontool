# Contract — Route Handlers (`src/app/api`)

Todos passam por `requireRole` no servidor (Princípio V) e são escopados por tenant.

## Catálogo (NOVO)

- `GET /api/materiais` — lista insumos (ativos; `?includeInactive=1` na gestão). Papel: qualquer autenticado do tenant (para o seletor). 
- `POST /api/materiais` — cria insumo `{ name, unitCostCents, tussCode? }`. Papel: `admin|financeiro`.
- `PATCH /api/materiais/[id]` — edita `{ name?, unitCostCents?, active?, reason? }`. Papel: `admin|financeiro`.

## Materiais do atendimento (ESTENDER)

- `POST /api/atendimentos/[id]/materiais` — anexa materiais; cada item aceita `unitCostCents?` e `materialId?`. Papel: atual (recepção/profissional) — custo-padrão do catálogo é aplicado automaticamente.
- `PATCH /api/atendimentos/[id]/materiais/[materialRowId]/custo` — completa/corrige custo pendente `{ unitCostCents, materialId?, reason }`. Papel: `admin|financeiro`.

## Relatórios (ESTENDER + NOVO drilldown)

- Endpoints de resultado/por-profissional/por-convênio/mensal e seus exports passam a incluir "Gasto com materiais".
- `GET /relatorios/materiais?from=&to=` (NOVO) — página/endpoint de drilldown listando os materiais do período (para o link do resultado operacional). Papel: `admin|financeiro`.

## Validação
- Zod em cada rota: `unitCostCents` inteiro ≥ 0; `reason` obrigatório no PATCH de custo; `name` 1–200.
- `lint:auth` deve continuar verde (requireRole em todas as rotas novas).

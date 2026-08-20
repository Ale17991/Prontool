# API Contracts — 049

Todas as rotas: `requireRole` server-side + gating de módulo onde indicado; RLS por tenant. Erros no padrão `{ error: { code, message } }`.

## Alimentos (US1) — ESTENDER

### `GET /api/alimentos?q=&group=&scope=`

- **ESTENDE**: cada alimento no resultado passa a incluir `micronutrients` (mapa `key→valor` por porção de referência) além de energia/macros/fibra. Chaves ausentes omitidas.
- Auth: `admin`/`profissional_saude`; gate `dieta`.

### `POST /api/alimentos` (cadastro próprio) — ESTENDER

- Body aceita `micronutrients?: Record<string, number>` (todos opcionais). Validação de plausibilidade no domínio (não-negativos, unidade coerente). Ausência = desconhecido.

## Recomendações / Adequação (US2)

### `GET /api/pacientes/[id]/adequacao?source=plano|recordatorio&ref_id=&sex=&age=&state=`

- Calcula a análise de adequação para o **plano ativo** ou um **recordatório** (`ref_id`) do paciente.
- `sex`/`age`/`state` opcionais sobrescrevem o que vem do cadastro (idade derivada da data de nascimento).
- Resposta: `{ totals, items: AdequacyItem[], summary: { deficits, excesses } }`, onde `AdequacyItem = { nutrientKey, label, unit, total, dri|null, pct|null, class }`.
- Auth: `admin`/`profissional_saude`; gate `dieta` (plano) ou `nutri_recordatorio` (recordatório).

## Recordatório (US3)

### `GET /api/pacientes/[id]/recordatorio`

- Lista os recordatórios do paciente (data + totais resumidos) + o mais recente detalhado (refeições/itens com nutrientes calculados).
- Auth: `admin`/`profissional_saude`; gate `nutri_recordatorio`.

### `POST /api/pacientes/[id]/recordatorio`

- Cria/atualiza um recordatório (um dia): `{ recall_date, notes?, meals: [{ name, position, items: [{ food_id, grams?, measure_label?, measure_qty? }] }] }`.
- Recalcula totais (energia+macros+micros) no servidor (motor isomórfico). Auditoria.
- Auth: `admin`/`profissional_saude`; gate `nutri_recordatorio`.
- **404 `MODULE_DISABLED`** quando o módulo está desligado (item de menu some e URL negada — SC-005).

## DRIs — sem rota pública de escrita

Catálogo global read-only (seed). Leitura acontece server-side dentro do cálculo de adequação; não há endpoint de edição pela clínica.

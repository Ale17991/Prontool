# API Contracts — 050 Exames Laboratoriais

Todas as rotas: `requireRole` server-side + gate de módulo + RLS por tenant. Erros no padrão `{ error: { code, message } }`.

Convenção de gate herdada da 049: módulo desligado → **404 `MODULE_DISABLED`** (não 403), para que a existência da funcionalidade não vaze.

---

## `GET /api/pacientes/[id]/exames`

Resultados laboratoriais do paciente, já classificados contra a faixa do seu sexo/idade.

**Auth**: `admin` | `profissional_saude`. **Gate**: `exames_lab`.

**Query params** (todos opcionais):
| Param | Efeito |
|---|---|
| `sex` | `M`/`F` — sobrescreve o cadastro |
| `age` | idade em anos — sobrescreve a derivada de `birth_date` |
| `state` | `padrao` (default) / `gestante` / `lactante` |
| `analyte` | filtra a série de um analito (usado pela evolução, US2) |

**200 — com sexo e idade resolvidos**:

```jsonc
{
  "patient": { "ageYears": 42, "sex": "F", "state": "padrao" },
  "panel": {
    "items": [
      { "analyteKey": "lab_ferritina", "label": "Ferritina", "group": "Hemograma",
        "unit": "mcg/L", "value": 18, "measuredAt": "2026-07-20",
        "refMin": 70, "refMax": 200, "sourceLabel": "Evonut BD_Exames",
        "class": "baixo" }
    ],
    "low": 1, "high": 0
  },
  "series": { "lab_ferritina": [ { "measuredAt": "2026-05-02", "value": 12 }, … ] }
}
```

- `items` = **último resultado de cada analito** (FR-001 cenário 5), ordenado com os alterados primeiro.
- `series` = histórico completo por analito, para o gráfico (US2).
- `class: "sem_referencia"` quando não há faixa aplicável (FR-007) — `refMin`/`refMax` vêm `null`.

**200 — sem sexo e/ou idade** (FR-006, edge case; **não** é erro):

```jsonc
{ "patient": null, "panel": null, "series": { … }, "need": { "age": true, "sex": false } }
```

A tela mostra os valores e pede o dado que falta para classificar. Comportamento copiado de `/api/pacientes/[id]/adequacao`.

**404** `MODULE_DISABLED` (módulo off) · `PATIENT_NOT_FOUND`.
**403** papel sem permissão.

---

## `POST /api/pacientes/[id]/exames`

Lança um laudo — N resultados com a mesma data, atomicamente.

**Auth**: `admin` | `profissional_saude`. **Gate**: `exames_lab`.

**Body**:

```jsonc
{
  "measuredAt": "2026-07-20",
  "notes": "Laboratório X",
  "results": [
    { "analyteKey": "lab_ferritina", "value": 18 },
    { "analyteKey": "hba1c", "value": 6.4 },
  ],
}
```

Validação Zod: `measuredAt` data ISO não-futura; `results` 1..60 itens, `value` numérico finito, `analyteKey` presente no catálogo.

**201**: `{ "recorded": 2, "panel": { … } }` — devolve o painel já reclassificado.

**Semântica**: delega a `recordMeasurementsBatch` — **atômico**, valida todas as entradas antes de inserir; um valor fora da faixa **plausível** rejeita o lote inteiro. Append-only: relançar o mesmo analito na mesma data cria um novo registro (correção), não sobrescreve.

**422** `MEASUREMENT_OUT_OF_RANGE` (com a lista de analitos problemáticos na mensagem) · `MEASUREMENT_REJECTED`.
**400** `INVALID_BODY` (com `issues` do Zod).
**404** `MODULE_DISABLED` · `PATIENT_NOT_FOUND`.

> Nota de consistência: a rota de recordatório (049) usa **400** para corpo inválido e a de solicitação de exames usa **422**. Esta rota segue o padrão da 049 (**400** para forma, **422** para regra de domínio).

---

## Faixas de referência — sem rota de escrita

`lab_reference_ranges` é catálogo global read-only para a clínica (RLS só `SELECT`, `GRANT` sem escrita). A leitura acontece server-side dentro do cálculo; **não existe endpoint de edição**. Manutenção é por seed (`pnpm seed:lab-ranges`).

## Exame próprio da clínica — rota existente

Cadastrar um analito fora do catálogo global usa o caminho já existente de métricas customizadas (`createCustomMetricType`, admin do tenant). Não há rota nova. Exame próprio nasce **sem faixa de referência** → seus resultados aparecem como `sem_referencia`.

## Portal do paciente

Sem rota nova. A seção `exames` é servida pelo bundle do painel (`buildPatientPortalBundle`), gated por `resolvePortalSections` (módulo `exames_lab` → override da clínica → default `false` por sensibilidade). Mostra valor, data e **normal/alterado** — sem % e sem alarmismo (SC-003).

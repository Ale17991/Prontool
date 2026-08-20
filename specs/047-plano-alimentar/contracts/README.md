# Contratos de rota — Plano Alimentar (047)

Todas as rotas: `requireRole` server-side + gate `hasModule('dieta')`. Sem módulo → **404/403** (não vazar existência da feature). Payloads validados com Zod. Erros no formato padrão do projeto: `{ error: { code, message } }`.

Papéis: **escrita** = `admin` \| `profissional_saude`. **Leitura** = os mesmos (recepcionista/financeiro não acessam plano alimentar — é dado clínico).

---

## 1. `GET /api/alimentos`

Busca no catálogo (global + alimentos próprios da clínica).

**Query**: `q` (texto, min 2), `group` (slug, opcional), `limit` (default 20, máx 50), `scope` (`all` \| `custom`, default `all`)

**200**

```json
{
  "foods": [
    {
      "id": "uuid",
      "name": "Arroz, integral, cozido",
      "source": "taco",
      "isCustom": false,
      "group": { "slug": "carboidratos", "label": "Carboidratos" },
      "referenceGrams": 100,
      "energyKcal": 124.0,
      "proteinG": 2.6,
      "carbG": 25.8,
      "fatG": 1.0,
      "fiberG": 2.7,
      "measures": [{ "label": "colher de sopa", "grams": 25, "isDefault": true }]
    }
  ]
}
```

**403** sem papel de leitura · **404** sem módulo `dieta`

---

## 2. `POST /api/alimentos`

Cadastra alimento próprio da clínica (FR-005).

**Body**

```json
{
  "name": "Whey isolado — Marca X",
  "group_slug": "proteinas",
  "reference_grams": 30,
  "energy_kcal": null,
  "protein_g": 24,
  "carb_g": 1,
  "fat_g": 0.5,
  "fiber_g": 0,
  "micros": {},
  "measures": [{ "label": "scoop", "grams": 30, "is_default": true }]
}
```

- `energy_kcal` **nulo → derivado por Atwater** `4P + 4C + 9L` (FR-007).
- Sempre gravado com `tenant_id` da sessão e `source: 'custom'` — o cliente **não** escolhe o tenant nem a origem.

**201** `{ "id": "uuid", "energyKcal": 104.5 }`
**422** valor implausível (FR-019), com mensagem apontando o campo
**403** papel sem escrita

---

## 3. `PATCH /api/alimentos/[id]` · `DELETE /api/alimentos/[id]`

Edita/desativa alimento **próprio**. `DELETE` é **desativação lógica** (`active = false`), nunca remoção física — planos prescritos que o referenciam precisam continuar íntegros.

**200** `{ "ok": true }`
**403** tentativa sobre alimento **global** (`tenant_id IS NULL`) → negado pela RLS e pelo trigger
**404** alimento de outro tenant (indistinguível de inexistente — não confirma existência)

---

## 4. `GET /api/alimentos/grupos`

Grupos alimentares + listas de substituição visíveis à clínica.

**200**

```json
{
  "groups": [{ "slug": "carboidratos", "label": "Carboidratos", "displayOrder": 1 }],
  "equivalenceLists": [
    {
      "id": "uuid",
      "groupSlug": "carboidratos",
      "name": "Carboidratos — 1 porção (≈80 kcal)",
      "referenceKcal": 80,
      "isCustom": false,
      "items": [{ "foodId": "uuid", "name": "Arroz integral cozido", "grams": 65 }]
    }
  ]
}
```

---

## 5. `GET /api/pacientes/[id]/plano-alimentar`

Plano vigente do paciente + meta + histórico de prescrições.

**200**

```json
{
  "plan": {
    "id": "uuid",
    "title": "Plano de manutenção",
    "status": "rascunho",
    "meals": [
      {
        "id": "uuid",
        "name": "Café da manhã",
        "timeLabel": "07:00",
        "position": 0,
        "items": [
          {
            "id": "uuid",
            "foodId": "uuid",
            "name": "Pão integral",
            "grams": 50,
            "measureLabel": "fatia",
            "measureQty": 2,
            "equivalenceListId": null,
            "nutrients": { "energyKcal": 130, "proteinG": 5, "carbG": 24, "fatG": 1.5, "fiberG": 3 }
          }
        ],
        "totals": { "energyKcal": 130, "proteinG": 5, "carbG": 24, "fatG": 1.5, "fiberG": 3 }
      }
    ],
    "totals": { "energyKcal": 130, "proteinG": 5, "carbG": 24, "fatG": 1.5, "fiberG": 3 }
  },
  "target": {
    "kcal": 2200,
    "protG": 165,
    "carbG": 220,
    "fatG": 73,
    "assessmentId": "uuid",
    "assessedAt": "2026-07-20"
  },
  "delta": { "kcal": -2070, "protG": -160, "carbG": -196, "fatG": -71.5 },
  "prescriptions": [{ "id": "uuid", "prescribedAt": "2026-07-21T13:00:00Z", "totalKcal": 2180 }]
}
```

- `target` e `delta` são **`null`** quando o paciente não tem avaliação com meta (edge case da spec: o plano funciona sem meta).
- Em plano `prescrito`, `nutrients` vem do **snapshot congelado**; em rascunho, calculado ao vivo da base.

---

## 6. `POST /api/pacientes/[id]/plano-alimentar` · `PATCH …`

Cria/edita o **rascunho** (refeições e itens). Aceita o cardápio inteiro num único payload — a tela edita várias refeições e salva de uma vez.

**Body**

```json
{
  "title": "Plano de manutenção",
  "assessment_id": "uuid | null",
  "meals": [
    {
      "name": "Café da manhã",
      "time_label": "07:00",
      "position": 0,
      "items": [
        {
          "food_id": "uuid",
          "grams": 50,
          "measure_label": "fatia",
          "measure_qty": 2,
          "equivalence_list_id": null,
          "notes": null
        }
      ]
    }
  ]
}
```

- `grams` **ou** (`measure_label` + `measure_qty`) — se vier medida caseira, o servidor **converte para gramas** (FR-012) e persiste ambos.
- Item sem `food_id` é aceito como **texto livre** (`food`), preservando o comportamento legado — apenas não entra no cálculo.

**200** devolve o plano recalculado (mesmo shape do GET)
**409** tentativa de editar plano já `prescrito` → orienta criar nova versão
**422** grama/medida ausente ou implausível

---

## 7. `POST /api/pacientes/[id]/plano-alimentar/prescrever`

Congela e registra a prescrição (FR-013, FR-017). **Operação atômica.**

**Body**: `{ "plan_id": "uuid" }`

**201**

```json
{
  "prescriptionId": "uuid",
  "prescribedAt": "2026-07-21T13:00:00Z",
  "totalKcal": 2180,
  "totalMacros": { "protG": 160, "carbG": 218, "fatG": 72 }
}
```

**422** plano sem nenhuma refeição com item calculável
**403** papel sem escrita
**409** plano já prescrito e sem alterações desde a última prescrição

**Efeitos**: grava `snap_*` nos itens · copia a meta vigente · insere `diet_plan_prescriptions` · `status = 'prescrito'` · `log_audit_event`.

---

## 8. Portal do paciente (existente, estendido)

`src/lib/core/patient-portal/diet.ts` passa a ler **a prescrição mais recente** (`diet_plan_prescriptions.snapshot`) em vez do rascunho. Sem prescrição → o portal não mostra plano (rascunho é trabalho interno, não se entrega ao paciente).

Contrato do card do portal: refeições, itens com quantidade e medida caseira, opções de substituição, totais do dia. **Sem edição** — o portal é somente leitura.

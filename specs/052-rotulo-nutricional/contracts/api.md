# API Contracts — 052 Rótulo Nutricional

Todas as rotas: `requireRole(['admin','profissional_saude'])` + gate `nutri_rotulo` + RLS por tenant. Erros no padrão `{ error: { code, message } }`.

Convenção herdada da 049/050: módulo desligado → **404 `MODULE_DISABLED`**, para não vazar a existência da funcionalidade.

O rótulo **não tem `patient_id`** — as rotas ficam em `/api/rotulos`, não sob `/api/pacientes/[id]`.

---

## `GET /api/rotulos`

Lista os rótulos da clínica.

**200**: `{ labels: [{ id, productName, clientName, basis, incomplete, updatedAt }] }` — ordenado por `updatedAt` desc. O campo `incomplete` permite mostrar na lista quais ainda não estão prontos para embalagem.

---

## `POST /api/rotulos`

Cria um rótulo.

**Body**:
```jsonc
{
  "productName": "Bolo de cenoura com cobertura",
  "clientName": "Confeitaria da Ana",
  "basis": "solido",                    // solido | liquido
  "totalYield": 1200,                   // rendimento informado, NUNCA deduzido
  "portionSize": 60,
  "householdMeasure": "1 fatia",
  "portionsPerPackage": 20,
  "ingredients": [
    { "foodId": "…", "grams": 300, "position": 0 }
  ],
  "ingredientsText": "Farinha de trigo, cenoura, ovos, açúcar…",
  "allergensText": "ALÉRGICOS: CONTÉM TRIGO, OVOS E LEITE.",
  "storageText": "Conservar em local seco e arejado."
}
```

Validação Zod: `totalYield > 0`; `portionSize > 0`; **`portionSize <= totalYield`**; `ingredients` 1..80 itens com `grams > 0`; `basis` no enum.

**201**: `{ id, result }` — `result` é o `LabelResult` já calculado (tabela + lupa + `incomplete`).

**400** `INVALID_BODY` · **422** `PORTION_EXCEEDS_YIELD`.

---

## `GET /api/rotulos/[id]`

Rótulo completo + tabela recalculada.

**200**:
```jsonc
{
  "label": { "id": "…", "productName": "…", "basis": "solido", "totalYield": 1200,
             "portionSize": 60, "householdMeasure": "1 fatia", "portionsPerPackage": 20,
             "ingredientsText": "…", "allergensText": "…", "storageText": "…",
             "normativeVersion": "IN 75/2020 + RDC 429/2020",
             "ingredients": [{ "foodId": "…", "name": "Farinha de trigo", "grams": 300 }],
             "manualValues": { "acucar_adicao_g": 18.5 } },
  "result": {
    "rows": [
      { "key": "energia", "label": "Valor energético", "unit": "kcal",
        "per100": 342, "perPortion": 205, "dvPercent": 10,
        "state": "calculado", "missingFrom": [] },
      { "key": "acucar_adicao_g", "label": "Açúcares adicionados", "unit": "g",
        "per100": 22, "perPortion": 13, "dvPercent": 26,
        "state": "sobrescrito", "missingFrom": [] },
      { "key": "ag_trans_g", "label": "Gorduras trans", "unit": "g",
        "per100": null, "perPortion": null, "dvPercent": null,
        "state": "incompleto", "missingFrom": ["Margarina", "Cobertura pronta"] }
    ],
    "frontOfPack": { "acucar_adicionado": "aplica",
                     "gordura_saturada": "nao_aplica",
                     "sodio": "inconclusivo" },
    "incomplete": true,
    "normativeVersion": "IN 75/2020 + RDC 429/2020"
  }
}
```

**Regras que o contrato garante**:
- Nutriente incompleto vem com `per100`/`perPortion`/`dvPercent` = **`null`**, nunca `0` (FR-010, SC-004).
- Açúcares totais vêm sempre com `dvPercent: null` — a norma não estabelece VDR para eles (FR-009).
- `frontOfPack` é `inconclusivo` quando o nutriente relevante está incompleto — **nunca** `nao_aplica` (FR-015).
- Os valores já vêm arredondados pelas regras dos Anexos III e IV. O bruto não sai da API.

**404** `LABEL_NOT_FOUND` · `MODULE_DISABLED`.

---

## `PATCH /api/rotulos/[id]`

Edita o rótulo — inclusive as sobrescritas manuais.

**Body** (todos opcionais): os mesmos campos do POST, mais:
```jsonc
{ "manualValues": { "acucar_adicao_g": 18.5, "ag_trans_g": null } }
```

`manualValues` é aplicado por chave: valor numérico **define** a sobrescrita; `null` **remove** (desfaz, voltando ao calculado — FR-013).

**200**: mesmo payload do GET, recalculado.
**400** `INVALID_BODY` · **422** `PORTION_EXCEEDS_YIELD` · **404** como acima.

---

## `DELETE /api/rotulos/[id]`

Remove o rótulo e seus ingredientes (cascade). Rótulo é rascunho de trabalho, não histórico — pode ser apagado.

**204** · **404** como acima.

---

## `GET /api/rotulos/[id]/pdf`

Documento para impressão: tabela nutricional em três colunas, lista de ingredientes, alérgenos, conservação e as marcas frontais aplicáveis.

**200**: `application/pdf`.

**Regra**: quando `result.incomplete` é `true`, o PDF **MUST** sair com marca inequívoca de que o rótulo não está pronto para uso em embalagem, listando os nutrientes pendentes (FR-018). Não existe exportação "limpa" de rótulo incompleto.

---

## Sem rota de referências normativas

VDR, limites da lupa e regras de arredondamento são constantes de código (research D2) — não há endpoint de leitura nem de edição. A versão usada acompanha cada rótulo em `normativeVersion`.

## Base de alimentos

Reuso de `GET /api/alimentos` (047/049) para escolher os ingredientes. Nenhuma rota nova — mas a busca precisa devolver os quatro micronutrientes de rótulo, o que já faz desde a 049.

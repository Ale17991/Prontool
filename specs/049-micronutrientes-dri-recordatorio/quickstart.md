# Quickstart — 049 Micronutrientes, DRIs, Adequação e Recordatório

Roteiro de validação manual. Complementa os testes automatizados (que provam que a soma/adequação fecham); aqui se prova que serve para atender.

## Preparação

```bash
npx supabase start
pnpm supabase:reset            # aplica migrations novas (micros, DRIs, recordatório)
pnpm seed:foods-micros         # importa a BD ALIMENTOS (AF) c/ micros como base global
pnpm seed:dris                 # semeia a tabela de DRIs (BD_DRIs)
pnpm seed:demo
pnpm dev
```

Login: `admin@clinica-demo.test` / `demo1234`. Módulos `dieta` e `nutri_recordatorio` ligados (demo fail-open).

## US1 — Micronutrientes na base

1. **Config → Alimentos**, buscar um alimento (ex.: `feijão`). **Esperado**: além de energia/macros/fibra, aparecem os micronutrientes disponíveis (ferro, cálcio, vitaminas…) com unidade.
2. Cadastrar alimento próprio informando alguns micros (ex.: cálcio 120 mg). **Esperado**: salva e passa a contar nos planos.
3. Montar um plano com 2–3 alimentos. **Esperado**: os totais do dia incluem micros somados; conferir uma soma na mão (SC-002).
4. Incluir um alimento sem um micro específico. **Esperado**: o total daquele micro ignora o ausente e sinaliza "pode estar subestimado".

## US2 — DRIs + Análise de adequação

5. Com um paciente de idade/sexo conhecidos e um plano montado, abrir a **análise de adequação**. **Esperado**: por nutriente, total × DRI da faixa do paciente, % e classificação **abaixo (<90%) / adequado (90–110%) / acima (>110%)**; carências e excessos destacados.
6. Paciente **sem** idade/sexo no cadastro. **Esperado**: a tela permite informar idade/sexo sem bloquear.
7. Nutriente sem DRI. **Esperado**: aparece o total, marcado "sem referência", sem %.

## US3 — Recordatório (R24h)

8. **Operação → Recordatório**, escolher paciente, montar as refeições de um dia com alimentos + quantidades (grama ou medida caseira). **Esperado**: totais de energia/macros/micros ao vivo.
9. Salvar. **Esperado**: entra no histórico do paciente com data e totais.
10. Abrir a **adequação** sobre o recordatório. **Esperado**: mesma leitura da US2, sobre o consumo real.
11. **Gate**: desligar `nutri_recordatorio` no `/admin`. **Esperado**: item de menu some e URL direta é negada (SC-005).

## Isolamento

12. Com dois tenants, confirmar que recordatórios e alimentos próprios de um **não** aparecem no outro; base global e DRIs aparecem nos dois (SC-006).

## O que este roteiro NÃO cobre

A **fidelidade clínica** dos valores de micros e das DRIs contra a fonte — exige a nutricionista conferindo amostras contra a planilha (análogo ao T047 da 047).

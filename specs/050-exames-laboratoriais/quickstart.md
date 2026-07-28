# Quickstart — 050 Exames Laboratoriais

Roteiro de validação manual. Os testes automatizados provam que a classificação fecha; aqui se prova que serve para atender.

## Preparação

```bash
npx supabase start
pnpm supabase:reset          # aplica a 0184 (tabela de faixas + catálogo de exames)
pnpm seed:lab-ranges         # importa as faixas do Evonut!BD_Exames
pnpm seed:demo
pnpm dev
```

Login: `admin@clinica-demo.test` / `demo1234`. O módulo `exames_lab` está ligado (demo é `legacy` → fail-open em todos os módulos).

Antes de semear valendo, confira a extração: `DRY=1 pnpm seed:lab-ranges` imprime as contagens sem gravar. Esperado, conforme o levantamento: ~115 linhas com faixa aproveitadas de 319, ~180 qualitativas e 22 pseudo-painéis descartados, e **zero** unidade desconhecida (se aparecer alguma, o mapa de aliases está incompleto — não ignore).

> ⚠️ Rodar `vitest` apaga o banco local. Se testar depois, re-seedar com `pnpm seed:demo` + `pnpm seed:lab-ranges`.

## US1 — Registro com flag automático

1. Abra um paciente **com sexo e data de nascimento preenchidos** → aba Cadastro → seção **Exames laboratoriais**.
2. **Lançar laudo**: informe a data e 8–10 exames (ex.: glicemia 110, HbA1c 6,4, LDL 180, HDL 38, ferritina 18, TSH 2,1, hemoglobina 11,2, TGP 60). Salve.
   **Esperado**: todos aparecem com valor, **faixa de referência ao lado** e classificação **baixo/normal/alto**; os alterados destacados e listados primeiro. Cronometre — SC-001 pede menos de 5 minutos para o conjunto.
3. Confira **um caso na mão** contra a planilha (SC-002). Bom par: **ferritina** (H 70–150, M 70–200) e **hemoglobina** (H 14–16, M 13,5–15,5) — os dois divergem por sexo, então o mesmo valor deve classificar diferente em paciente homem e mulher. É o teste que prova que o recorte por sexo está vivo.
4. **Exame sem faixa**: lance um analito próprio da clínica (Configurações → métricas customizadas) e registre um valor.
   **Esperado**: valor registrado e exibido marcado **"sem referência"**, sem flag (FR-007).
5. **Paciente sem sexo/idade** no cadastro: abra a seção.
   **Esperado**: os valores aparecem, a tela **pede sexo/idade** para classificar e permite informar ali, **sem bloquear** o registro (FR-006).
6. **Append-only**: tente corrigir um valor digitado errado.
   **Esperado**: não há editar/excluir; a correção é um novo lançamento, e a tela diz isso com todas as letras.
7. **Valor absurdo** (ex.: hemoglobina 900): salve.
   **Esperado**: 422 com mensagem clara e **nada gravado do lote inteiro** (atomicidade). Se um valor *clinicamente* muito alterado (ex.: ferritina 2000) for rejeitado, a faixa plausível do seed está apertada demais — é o risco registrado no `research.md`, corrigir o seed.

## US2 — Evolução

8. Lance o **mesmo exame em 3 datas** diferentes (ex.: glicemia 130 → 118 → 102).
9. Abra a evolução daquele exame.
   **Esperado**: linha do tempo com os 3 pontos e a **faixa normal desenhada como banda** ao fundo (SC-004), com o eixo Y englobando a faixa.
10. Um exame com **um só** resultado.
    **Esperado**: mensagem "a linha aparece a partir da segunda medição" (comportamento atual do componente), sem quebrar.

## US3 — Portal do paciente

11. **Configurações → Portal do paciente**: a seção **"Resultados de exames"** deve aparecer **ligável** (hoje é "Em breve"). Ligue.
12. Entre no portal como o paciente (CPF + data de nascimento).
    **Esperado**: seção com os exames recentes — valor, data e **normal/alterado**. Sem jargão, sem percentual, sem alarmismo (SC-003).
13. Desligue a seção nas configurações e recarregue o portal.
    **Esperado**: a seção some.

## Gating do módulo (SC-005)

14. No **/admin**, desligue `exames_lab` da clínica.
    **Esperado**: a seção some do prontuário; `GET/POST /api/pacientes/<id>/exames` respondem **404 `MODULE_DISABLED`**; a seção some do portal.

## Isolamento (SC-006)

15. Com duas clínicas, confirme que resultados de uma **não** aparecem na outra, e que o **catálogo de exames e as faixas** aparecem nas duas (catálogo é global).

## Validação com o profissional (polish)

16. Sentar com a nutricionista/médico e conferir uma amostra de 10–15 faixas contra a referência que usam na prática. **Duas limitações conhecidas a declarar na conversa**: (a) as faixas vêm de uma planilha sem fonte citada; (b) **o v1 classifica por sexo, não por idade** — a planilha de origem não tem recorte etário. Decidir se alguma faixa precisa de correção antes de expor a clínicas reais.

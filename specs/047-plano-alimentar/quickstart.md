# Quickstart — Plano Alimentar (047)

Roteiro de validação manual. Complementa os testes automatizados: eles provam que a soma fecha; este roteiro prova que **a tela serve para atender**.

## Preparação

```bash
npx supabase start            # se o Docker estiver parado
pnpm supabase:reset           # aplica migrations, incl. 0176
pnpm seed:foods               # semeia o catálogo global de alimentos
pnpm seed:demo                # tenant demo + usuários
pnpm dev                      # http://localhost:3000
```

Login: `admin@clinica-demo.test` / `demo1234`

> **Depois de qualquer `vitest`**, re-rodar `pnpm seed:demo`. Sobre o catálogo de alimentos após os testes, ver a Decisão D3 em `research.md` — se ele desaparecer no reset, é exatamente o gotcha do `catalog_baseline`.

O módulo `dieta` precisa estar ativo. O tenant demo cai no **fail-open** (sem linha em `tenant_entitlements` → `legacy` + todos os módulos), então deve funcionar sem configurar nada.

---

## US1 — Base de alimentos

1. Ir em **Configurações → Alimentos**.
2. Buscar `arroz`. **Esperado**: resultados do catálogo global com grupo, porção de referência, energia e macros. A busca deve tolerar acento (`ARROZ`, `arroz`, `açúcar` vs `acucar`).
3. Cadastrar um alimento próprio: nome, grupo, porção 30 g, proteína 24, carbo 1, lipídio 0,5 — **deixando a energia em branco**.
   **Esperado**: salva e mostra energia ≈ **104,5 kcal** (Atwater: 4×24 + 4×1 + 9×0,5). _(FR-007)_
4. Tentar cadastrar com energia `5000` por 100 g.
   **Esperado**: **422** com mensagem clara apontando o campo. Não salva. _(FR-019)_
5. Conferir que o alimento próprio aparece na busca **marcado como da clínica**, e que o global **não é editável**.

---

## US2 — Cardápio e cálculo

6. **Operação → Plano Alimentar**, escolher um paciente.
7. Criar refeição "Café da manhã", adicionar `Pão integral` com **2 fatias** (medida caseira).
   **Esperado**: converte para gramas e mostra os nutrientes proporcionais. _(FR-012)_
8. Adicionar mais itens e outra refeição.
   **Esperado**: totais **por refeição** e **do dia** atualizam **ao vivo**, sem salvar. _(FR-010)_
9. **Conferir a soma na mão** em pelo menos uma refeição. Os totais têm que bater exatamente, à parte arredondamento. _(SC-002)_
10. Se o paciente tiver avaliação nutricional com meta, conferir o painel de **comparação com a meta** (kcal e macros, com o quanto falta/sobra). _(FR-011, SC-003)_
11. Paciente **sem** avaliação: o plano deve montar normalmente, apenas **sem** o bloco de comparação. _(edge case)_

---

## US3 — Substituições

12. Em Configurações → Alimentos, abrir uma **lista de substituição** de um grupo (ex.: Carboidratos ≈ 80 kcal) e conferir os alimentos elegíveis com suas gramagens.
13. No cardápio, marcar um item como pertencente a essa lista.
    **Esperado**: as opções "**ou**" aparecem no item. _(FR-015)_

---

## US4 — Prescrição e entrega

14. Clicar em **Prescrever**.
    **Esperado**: o plano vira `prescrito`; aparece no histórico de prescrições com data e total.
15. Tentar **editar** o plano prescrito.
    **Esperado**: bloqueado (**409**), orientando criar nova versão. _(FR-013)_
16. **O teste que mais importa** — ir em Configurações → Alimentos e **alterar drasticamente** os macros de um alimento usado no plano prescrito (ex.: dobrar a proteína). Voltar ao plano prescrito.
    **Esperado**: os números do plano prescrito **não mudam**. _(FR-017, SC-004)_
17. Abrir o **portal do paciente** e conferir a seção "Plano alimentar".
    **Esperado**: exatamente o que foi prescrito — refeições, itens, medidas, substituições. _(SC-007)_
18. Gerar a versão para **impressão/compartilhamento** e conferir que bate com o prescrito. _(FR-016)_

---

## Gates de segurança

19. **Sem o módulo**: desligar `dieta` no `/admin` para o tenant.
    **Esperado**: item de menu some **e** o acesso direto por URL é negado. _(SC-006)_
20. **Papel sem permissão**: logar como `recepcao@clinica-demo.test`.
    **Esperado**: não acessa plano alimentar nem cadastra alimento. _(FR-002)_
21. **Isolamento**: com dois tenants, confirmar que alimento próprio e plano de um **não** aparecem no outro, e que o catálogo global aparece nos dois. _(SC-005)_

---

## Desempenho

22. **SC-001**: cronometrar a montagem de um cardápio de um dia (4–5 refeições, ~15 itens) usando a busca. **Alvo: menos de 10 minutos.** Se passar disso, o gargalo costuma ser a busca de alimento — vale revisar o typeahead antes de considerar a história pronta.

---

## O que este roteiro NÃO cobre

A **validação nutricional propriamente dita** — se a base de alimentos tem os valores certos e se o plano faz sentido clínico. Isso exige a nutricionista, comparando com a fonte que ela usa hoje. Mesma lacuna registrada na 046 (T039): teste automatizado prova consistência interna, não adequação clínica.

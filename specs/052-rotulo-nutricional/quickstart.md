# Quickstart — 052 Rótulo Nutricional

Roteiro de validação manual. Os testes automatizados provam que as contas fecham; aqui se prova que o documento serve para ir numa embalagem.

## Preparação

```bash
npx supabase start
pnpm supabase:reset       # aplica a 0187
pnpm seed:demo
pnpm dev
```

Login: `admin@clinica-demo.test` / `demo1234`. A clínica demo é `legacy` (fail-open), então `nutri_rotulo` já está ligado.

> ⚠️ `vitest` apaga o banco local. Re-seedar depois com `pnpm seed:demo`.

## US1 — A tabela

1. **Operação → Rótulo Nutricional → Novo**.
2. Produto: `Bolo de cenoura`. Cliente: `Confeitaria da Ana`. Base: **sólido**.
3. Ingredientes (busca na base de alimentos):

| Ingrediente      | Quantidade |
| ---------------- | ---------- |
| Farinha de trigo | 300 g      |
| Cenoura          | 250 g      |
| Ovo              | 150 g      |
| Açúcar           | 200 g      |
| Óleo de soja     | 100 g      |

4. **Rendimento total: 900 g** (menos que os 1.000 g de ingredientes — é a perda por cocção). **Porção: 60 g**, medida caseira `1 fatia`, 15 porções por embalagem.
5. **Esperado**: tabela com os 10 nutrientes obrigatórios em três colunas — por 100 g, por porção e %VD.

**A conta que prova tudo (SC-002)**: pegue o valor energético por 100 g na tela, multiplique por 0,6 (a porção é 60 g) e compare com a coluna "por porção". Tem que bater. Depois divida o valor da porção por 2000 kcal e compare com o %VD — tem que bater também.

6. **Açúcares totais**: confira que aparece **sem %VD**. A norma não estabelece valor diário para eles — se aparecer um percentual, está errado.
7. Troque a base para **líquido** e confira que a coluna vira "por 100 mL".
8. Tente porção de 1.500 g com rendimento de 900 g. **Esperado**: recusa explicando que a porção não pode ser maior que o rendimento.

## US2 — O que a base não sabe

9. Olhe a linha de **gorduras trans** e **açúcares adicionados**. Com esses ingredientes, é bem provável que apareçam como **incompleto**, listando quais ingredientes não têm o dado.
   **Esperado**: aparece marcado, **não** aparece `0`. Se aparecer zero, é bug grave — vira declaração falsa na embalagem.
10. Informe o valor de açúcares adicionados à mão. **Esperado**: a tabela recalcula, a linha deixa de estar incompleta e fica visivelmente marcada como valor informado.
11. Desfaça a sobrescrita. **Esperado**: volta a incompleto.
12. **Zero declarado vs desconhecido**: monte um preparo só com um alimento que tenha sódio conhecido e baixo (≤ 5 mg por porção). **Esperado**: aparece `0` — sem marca de incompleto. É a declaração correta, e é diferente do caso 9.

## US3 — A lupa

13. Aumente o açúcar do preparo até passar de 15 g por 100 g. **Esperado**: o sistema indica **alto em açúcares adicionados**.
14. Reduza abaixo do limite. **Esperado**: a marca some.
15. Mude a base para **líquido** com a mesma composição. **Esperado**: o limite passa a ser 7,5 g por 100 mL — um produto que não se enquadrava como sólido pode se enquadrar como líquido.
16. Deixe o sódio incompleto. **Esperado**: a lupa de sódio diz **inconclusivo** — nunca "não se aplica". Concluir que não precisa de lupa a partir de dado faltante é o erro mais caro desta feature.

## US4 — Salvar e imprimir

17. Salve, saia da tela, reabra. **Esperado**: ingredientes, rendimento, porção e **os valores informados à mão** voltam intactos.
18. Exporte o PDF de um rótulo **completo**. **Esperado**: tabela em três colunas, ingredientes, alérgenos, conservação e as marcas frontais.
19. Exporte um rótulo **incompleto**. **Esperado**: o documento diz de forma inequívoca que não está pronto para embalagem e lista o que falta.

## Gating (SC-007) e isolamento (SC-008)

20. No **/admin**, desligue `nutri_rotulo` da clínica. **Esperado**: o item some do menu e o acesso direto por URL responde 404.
21. Com duas clínicas, confirme que os rótulos de uma não aparecem na outra.

## Conferência da norma — bloqueante antes do merge

22. Abrir o texto oficial da ANVISA e conferir, **um a um**, contra `reference.ts`:
    - os 10 VDR do Anexo II da IN 75/2020
    - as regras de arredondamento do Anexo III
    - as quantidades não significativas do Anexo IV
    - os 6 limites da rotulagem frontal da RDC 429/2020 (3 nutrientes × sólido/líquido)

    Atenção especial ao **VDR de gorduras trans** (2 g nas fontes consultadas) — a norma anterior não estabelecia valor diário para trans, então esse é o número com maior chance de estar errado nas fontes secundárias.

23. Validação com a nutricionista: gerar o rótulo de um produto real que ela já tenha rotulado antes, e comparar linha a linha com o que foi para a embalagem.

# Quickstart — Honorários e participantes por procedimento

Validação ponta a ponta (dev local: `supabase start` + `pnpm seed:demo`).

## 1. Pré-condições

- Migration `0128` aplicada (`pnpm supabase:reset` em dev) + tipos gerados.
- Domínio 35 semeado: `pnpm seed:tiss-domains` (grau de participação).
- Um atendimento **realizado** (status ativo) com pelo menos um procedimento.
- Médicos participantes cadastrados (com CPF/conselho/UF/CBO para faturar TISS).

## 2. Cadastrar a equipe (US1)

1. Abrir o atendimento → na linha de um procedimento, "Adicionar participante".
2. Escolher profissional (qualquer modalidade), grau (lista do domínio 35) e honorário.
3. Adicionar um segundo participante (modalidade diferente) ao mesmo procedimento.
4. **Esperado**: ambos aparecem vinculados ao procedimento; honorários congelados; duplicar o mesmo médico no mesmo procedimento é bloqueado.

## 3. Repasse (US2)

1. Ir em Análise → Repasse Médico no mês do atendimento.
2. **Esperado**: a linha de cada participante inclui a soma dos honorários das suas participações (qualquer modalidade).
3. Estornar o atendimento → o honorário sai da conta do repasse.

## 4. Guia TISS SP/SADT (US3)

1. Com operadora TISS configurada + carteira + executante completo, gerar guia **SP/SADT** do atendimento.
2. **Esperado**: a guia inclui o bloco `equipeSadt` com os participantes e graus; valida no XSD; fica `pronta`.
3. Remover o CBO de um participante e gerar de novo → guia `rascunho` com pendência apontando o participante.

## 5. Correção (US4)

1. Remover uma participação com valor errado e registrar a correta.
2. **Esperado**: repasse passa a usar a nova; auditoria mostra inclusão + remoção.

## Critérios de aceite (resumo)

- Equipe por procedimento, qualquer modalidade, grau do catálogo, honorário congelado.
- Honorário soma no repasse (qualquer modalidade); sai no estorno.
- `equipeSadt` na SP/SADT válido no XSD; pendência quando participante incompleto.
- Append-only + auditoria em toda inclusão/remoção.

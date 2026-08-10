# Quickstart — Impressos da consulta de nutrição

Roteiro para validar a feature ponta a ponta com o app rodando. Serve tanto para
o desenvolvimento quanto para a conferência com a nutricionista (SC-003).

## Preparo

1. `npx supabase start` e `pnpm dev`.
2. Entrar com um usuário `admin` ou `profissional_saude`.
3. Ligar no `/admin`, para a clínica de teste: `nutri_avaliacao`, `dieta`,
   `nutri_recordatorio`, `exames_lab`.
4. Escolher um paciente **com data de nascimento e sexo preenchidos** — sem os
   dois, avaliação e curvas não calculam.

> Se rodar `vitest` antes, o banco local é apagado. Re-semear com `pnpm seed:demo`.

## Roteiro

### 1. Plano alimentar (US1)

1. Operação → Plano Alimentar, escolher o paciente.
2. Montar quatro refeições; em uma delas, adicionar um **grupo de substituição**.
3. Definir `%` por refeição em ao menos duas.
4. **Sem enviar ao paciente**, gerar o impresso.
   - Conferir: sai com **tarja de rascunho**.
   - Conferir: o grupo aparece como "ou", e a energia dele conta **uma vez**.
   - Conferir: os totais batem com o painel da tela, dígito a dígito.
5. Enviar ao paciente e gerar de novo — a tarja some.

### 2. Evolução da avaliação (US2)

1. Operação → Planejamento Nutricional, mesmo paciente.
2. Salvar **três avaliações** em datas diferentes, uma delas por bioimpedância.
3. Gerar o impresso de antropometria.
   - Conferir: três colunas, da mais antiga para a mais nova.
   - Conferir: cada coluna diz **qual protocolo** foi usado.
   - Conferir: a coluna de bioimpedância está identificada como tal.
4. Repetir com um paciente que tenha **uma só** avaliação.
   - Conferir: uma coluna, sem colunas vazias.

### 3. Orientações e anamnese (US3)

1. Ficha do paciente → aba Clínico → Orientações: inserir um modelo pronto
   (guia FODMAP serve, é o mais longo) e salvar.
2. Gerar o impresso.
   - Conferir: o texto sai íntegro, sem corte, com quebra de página limpa.
3. Configurações → Modelos de Anamnese → instalar "Anamnese Alimentar" e aplicar
   ao paciente, deixando **algumas perguntas em branco**.
4. Gerar o impresso da anamnese.
   - Conferir: as perguntas sem resposta aparecem **em branco**, não sumiram.

### 4. Recordatório e exames (US4)

1. Operação → Recordatório: lançar um dia com três refeições. Gerar o impresso.
2. Ficha → seção Exames: lançar resultados, sendo **um deles sem faixa
   cadastrada**. Gerar o impresso.
   - Conferir: o exame sem faixa sai **sem classificação** — não como "normal".

### 5. Infantil e gestacional (US5)

1. Num paciente pediátrico com peso e altura em sinais vitais, ativar as curvas
   de crescimento e gerar o impresso.
   - Conferir: as curvas foram **desenhadas** (não é tabela) e o ponto do
     paciente aparece sobre elas.
2. Numa gestante com IMC pré-gestacional, gerar o impresso gestacional.

### 6. Limites

1. Tentar gerar impresso de paciente **de outra clínica** pela URL: deve dar
   **404**, não 403.
2. Tentar como `recepcionista`: **403**.
3. Paciente anonimizado: **409**.
4. Documento de três páginas: conferir que a identificação do paciente e a
   numeração se repetem em todas.

## Conferência com a nutricionista (SC-003)

Para cada documento, abrir lado a lado com o equivalente da planilha, do mesmo
paciente, e comparar **campo a campo**. O que interessa não é a aparência, e sim:

- os mesmos campos estão presentes?
- os números batem?
- falta algo que ela usa e o impresso não traz?

Anotar divergência de número como **defeito**, e divergência de layout como
ajuste opcional.

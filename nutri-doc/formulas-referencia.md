# Fórmulas de Nutrição — Referência para Replicação 1:1

Documento de engenharia reversa das planilhas `Evonut.xlsm` e `AF..xlsm` (pasta `nutri-doc/`).
Objetivo: replicar em código, com fidelidade absoluta, as equações de Gasto Energético e Antropometria.

> **Regra de rigor**: todas as fórmulas abaixo foram transcritas **verbatim** das células. Onde algo
> não foi localizado, está marcado como **NÃO ENCONTRADO**. Onde depende de macro VBA, está marcado.

## Conferência contra a literatura primária (2026-07-20)

Todas as 16 equações de gasto e 10 protocolos de dobras foram conferidos contra as
publicações originais. **Nenhum coeficiente de FAO/WHO 1985, FAO/WHO 2004, Schofield,
Henry-Rees, Harris-Benedict (1919/1984), Mifflin, Cunningham, Tinsley, Jackson-Pollock
(3 e 7), Durnin-Womersley, Guedes, Faulkner, Weltman ou Siri estava errado.**

Corrigido (com teste de regressão em `tests/unit/nutrition-literature-fixes.spec.ts`):

1. **EER/IOM 2005 ignorava o nível de atividade.** A tela não renderizava campo para
   `eer: 'pa'` e o motor lia `eerPa`, que nunca era preenchido → PA caía em 1.0 e o EER
   saía sempre sedentário (−561 kcal/dia num adulto ativo). Agora o PA vem da tabela
   oficial do IOM 2005, que tem **quatro variantes** (sexo × adulto/pediátrico).
2. **Petroski masculino usava a equação feminina.** São famílias diferentes: masculino é
   quadrático em Σ (`1.10726863 − 0.00081201·Σ + 0.00000212·Σ² − 0.00041761·I`), feminino é
   logarítmico. Os sítios por sexo já estavam corretos. ~1,8 p.p. de erro no %gordura.
3. **Slaughter, constante do pré-púbere masculino: `−2.6` → `−1.7`.** O −2,6 não existe na
   publicação; a tabela de Slaughter (1988) traz −1,7 (pré-púbere branco), −3,4 (púbere),
   −5,5 (pós-púbere).

Registrado como **aviso não-bloqueante** (`advisories.ts`) em vez de correção de fórmula —
são usos fora do domínio de validação, e a decisão é clínica:

- **McArdle** é pediátrica (9–16 anos); o código não tinha teto etário.
- **Henry-Rees** foi publicada para 3–60 anos; o código extrapolava em ambas as pontas.
- **FAO/WHO 2004 e Schofield são a mesma equação em adultos** — o FAO 2004 readotou as
  equações de peso do Schofield. Devolvem o mesmo número (±0,05 kcal).
- **Schofield adulto usa só o peso** (a altura é coletada mas não entra); a família
  peso+altura existe e não está implementada.
- **Tinsley** foi derivada de 27 atletas de físico; **Harris-Benedict** superestima ~5%.
- **Slaughter** estratifica por estágio de Tanner, não por idade (até ~4 p.p. entre 12–14 anos).
- **EER/IOM 2005 abaixo de 3 anos** tem equação própria (`89·P − 100` + depósito).

Pendências conhecidas (não corrigidas):

- **"Cunningham" e "Katch-McArdle" são a mesma equação** (Cunningham 1980 e 1991; o segundo
  nome vem do livro-texto de McArdle/Katch). Hoje aparecem como se fossem escolas distintas,
  com 156 kcal/dia de diferença sem explicação. Correção é de rótulo.
- **Durnin-Womersley** usa a coluna agrupada (correta, porém menos precisa que a versão por
  faixa etária, que o sistema poderia usar já que tem a idade).
- **Weltman** pede a MÉDIA de duas medidas abdominais; a UI coleta uma só.
- Precisão da 3ª casa em Schofield pediátrico (`19.59`/`16.252`/`16.969` vs `19.6`/`16.25`/`16.97`)
  e no subescapular de McArdle 9–12 (`0.038` vs `0.0388`): **NÃO CONFIRMADAS** — artigos originais
  pagos/indisponíveis. Impacto < 1 kcal / desprezível.

> Os textos primários de Harris & Benedict (1919) e Roza & Shizgal (1984) não puderam ser lidos
> (indisponível e paywalled); a confirmação veio de artigos revisados por pares que os citam.

## Decisões de implementação (2026-07-16)

1. **Coeficientes = equação canônica publicada** (decisão do usuário). Onde a planilha diverge claramente
   do publicado (arredondamento/erro do autor), usar os **valores canônicos com precisão cheia**; a planilha
   é a autoridade para a **estrutura** (quais faixas etárias, quais sítios de dobra, adicionais de
   gestante/lactante, PAL, fatores de injúria) e para o que não for equação padrão. Correções conhecidas a aplicar:
   - **Mifflin-St Jeor**: usar `10·P + 6.25·A − 5·I (+5 H / −161 M)`.
     > **Corrigido em 2026-07-20**: a nota original dizia que a planilha "divergia" por ter
     > `9.99`/`4.92`. Não divergia — o artigo de 1990 publica **as duas formas**, e os autores
     > afirmam que a simplificação não afeta o poder preditivo. O termo `166·sexo − 161` do
     > original reduz-se exatamente a `+5` (H) / `−161` (M). Diferença: ~1,6 kcal/dia.
     > Mantemos a arredondada por ser a que as calculadoras de referência usam.
   - **Harris-Benedict 1984 (Roza-Shizgal)**: `13.397·P + 4.799·A − 5.677·I + 88.362` (H) / `9.247·P + 3.098·A − 4.330·I + 447.593` (F).
   - **Harris-Benedict 1919**: `66.473 + 13.7516·P + 5.0033·A − 6.7550·I` (H) / `655.0955 + 9.5634·P + 1.8496·A − 4.6756·I` (F).
   - **EER/IOM 2005**: reconferir a parentização (PA deve multiplicar peso **e** altura) e o termo aditivo `+107/+144` célula a célula antes de codar — possível quirk da planilha.
   - Demais equações: manter como transcrito (já batem com o publicado).
2. **Casos-gabarito**: gerados a partir das fórmulas (autoconsistentes) e validados por amostragem manual — as planilhas foram salvas **sem** dados de paciente, então não há par entrada→saída real (só confirmação dos termos constantes).

---

## 0. Convenções e mapeamento de variáveis

O `Calc_GastoEnerg` (Evonut, sheet9) mantém **duas** colunas de resultado equivalentes:

- Colunas `AF..AL` ("Avaliação 1..7") — apontam para a base interna `BD_GastoEnerg` (linhas 4..10).
- Colunas `AQ` (Masculino) / `AR` (Feminino) — apontam para a aba `'Gasto Energético'` (célula única do paciente).

Ambas usam **os mesmos coeficientes**; adotamos as colunas `AQ`/`AR` como forma canônica por serem de
paciente único e legíveis.

### Mapa de células de entrada (aba `'Gasto Energético'`, usada por AQ/AR)

| Célula | Significado                                                                            |
| ------ | -------------------------------------------------------------------------------------- |
| `I11`  | **Peso** (kg)                                                                          |
| `G11`  | **Altura** (cm)                                                                        |
| `K11`  | **Idade** (anos)                                                                       |
| `M11`  | **Massa Livre de Gordura / MLG** (kg)                                                  |
| `O17`  | Coeficiente de atividade física (**PA**) para as equações EER/IOM infantis             |
| `F48`  | Categoria de atividade física (**1..4**) para EER 2005/2023 adulto e gestante/lactante |

### Mapa de colunas da base `BD_GastoEnerg` (usado por AF..AL)

| Coluna | Significado                             |
| ------ | --------------------------------------- |
| `DD`   | Altura (cm)                             |
| `DE`   | Peso (kg)                               |
| `DF`   | Idade (anos)                            |
| `DG`   | MLG (kg)                                |
| `DI`   | Sexo (1 = M, 2 = F) — usado em EER 2023 |
| `DJ`   | Coeficiente PA (IOM infantil)           |

### Mapa de colunas da base `BD_Antropometria` (usado por `Calc_Antropometria`)

| Coluna    | Significado                                                  |
| --------- | ------------------------------------------------------------ |
| `CD`      | Altura (cm)                                                  |
| `CE`      | Peso (kg)                                                    |
| `CK`      | Circunferência do braço (cm) — usada para CMB/AMB            |
| `CV`      | Circunferência da cintura (cm)                               |
| `CW`      | Circunferência abdominal (cm)                                |
| `CX`      | Circunferência do quadril (cm)                               |
| `DG`      | Dobra **Bíceps** (mm)                                        |
| `DH`      | Dobra **Tríceps** (mm)                                       |
| `DI`      | Dobra **Peitoral** (mm)                                      |
| `DJ`      | Dobra **Axilar média** (mm)                                  |
| `DK`      | Dobra **Subescapular** (mm)                                  |
| `DL`      | Dobra **Abdominal** (mm)                                     |
| `DM`      | Dobra **Suprailíaca** (mm)                                   |
| `DO`      | Dobra **Coxa** (mm)                                          |
| `DP`      | Dobra **Panturrilha** (mm)                                   |
| `DW`      | % Gordura por **Bioimpedância** (entrada direta do aparelho) |
| `DQ`,`DS` | Diâmetros ósseos (para peso ósseo)                           |
| `EI`      | Data de nascimento (para cálculo de idade `YEARFRAC`)        |

Notação matemática abaixo: **P** = peso (kg), **A** = altura (cm), **I** = idade (anos), **MLG** = massa livre de gordura (kg),
**Σ** = soma das dobras cutâneas (mm), **PA** = coeficiente de atividade, **log10** = logaritmo base 10.

---

# A) GASTO ENERGÉTICO — 16 equações de TMB/GEB

Fonte: `Calc_GastoEnerg` (Evonut sheet9), colunas `AQ` (Masculino) e `AR` (Feminino), linhas 5–20 (+ helpers 22–35).

## A1. Harris-Benedict (1984) — linha 5

- **Masculino** (`AQ5`): `TMB = 13.4·P + 4.8·A − 5.68·I + 88.36`
- **Feminino** (`AR5`): `TMB = 9.25·P + 3.1·A − 4.33·I + 447.6`

## A2. Harris-Benedict (1919) — linha 6

- **Masculino** (`AQ6`): `TMB = 66.5 + 13.75·P + 5·A − 6.76·I`
- **Feminino** (`AR6`): `TMB = 655 + 9.56·P + 1.85·A − 4.68·I`

## A3. Mifflin-St Jeor (1990) — linha 7

- **Masculino** (`AQ7`): `TMB = 9.99·P + 6.25·A − 4.92·I + 5`
- **Feminino** (`AR7`): `TMB = 9.99·P + 6.25·A − 4.92·I − 161`

## A4. FAO/WHO (1985) — linha 8 (por faixa etária)

Estrutura: `IF` aninhado sobre a idade `I`. Coeficiente aplica-se sobre **P** (peso). Retorna `""` fora das faixas.

- **Masculino** (`AQ8`):
  | Faixa (anos) | TMB |
  |---|---|
  | 0–2 | `60.9·P − 54` |
  | 3–9 | `22.7·P + 495` |
  | 10–17 | `17.5·P + 651` |
  | 18–29 | `15.3·P + 679` |
  | 30–59 | `11.6·P + 879` |
  | ≥60 | `13.5·P + 487` |
- **Feminino** (`AR8`):
  | Faixa (anos) | TMB |
  |---|---|
  | 0–2 | `61·P − 51` |
  | 3–9 | `22.5·P + 499` |
  | 10–17 | `12.2·P + 746` |
  | 18–29 | `14.7·P + 496` |
  | 30–59 | `8.7·P + 829` |
  | ≥60 | `10.5·P + 596` |

## A5. FAO/WHO (2004) — linha 9 (por faixa etária)

- **Masculino** (`AQ9`):
  | Faixa | TMB |
  |---|---|
  | 0–2 | `59.512·P − 30.4` |
  | 3–9 | `22.706·P + 504.3` |
  | 10–17 | `17.686·P + 658.2` |
  | 18–29 | `15.057·P + 692.2` |
  | 30–59 | `11.472·P + 873.1` |
  | ≥60 | `11.711·P + 587.7` |
- **Feminino** (`AR9`):
  | Faixa | TMB |
  |---|---|
  | 0–2 | `58.317·P − 31.1` |
  | 3–9 | `20.315·P + 485.9` |
  | 10–17 | `13.384·P + 692.6` |
  | 18–29 | `14.818·P + 486.6` |
  | 30–59 | `8.126·P + 845.6` |
  | ≥60 | `9.082·P + 658.5` |

## A6. Schofield (1985) — linha 10 (por faixa etária; usa P e A)

- **Masculino** (`AQ10`):
  | Faixa | TMB |
  |---|---|
  | 0–<3 | `0.167·P + 15.174·A − 617.6` |
  | 3–<10 | `19.59·P + 1.303·A + 414.9` |
  | 10–<18 | `16.25·P + 1.372·A + 515.5` |
  | 18–<30 | `(0.063·P + 2.896)·239` |
  | 30–<60 | `(0.048·P + 3.653)·239` |
- **Feminino** (`AR10`):
  | Faixa | TMB |
  |---|---|
  | 0–<3 | `16.252·P + 10.232·A − 413.5` |
  | 3–<10 | `16.969·P + 1.618·A + 371.2` |
  | 10–<18 | `8.365·P + 4.65·A + 200` |
  | 18–<30 | `(0.062·P + 2.036)·239` |
  | 30–<60 | `(0.034·P + 3.538)·239` |

> Obs.: nas faixas adultas o resultado é dado em **MJ** e multiplicado por **239** para converter em kcal.

## A7. Henry-Rees (1991) — linha 11 (por faixa; resultado ×239)

- **Masculino** (`AQ11`):
  | Faixa | TMB |
  |---|---|
  | 3–9 | `(0.113·P + 1.689)·239` |
  | 10–17 | `(0.084·P + 2.122)·239` |
  | 18–29 | `(0.056·P + 2.8)·239` |
  | 30–59 | `(0.046·P + 3.16)·239` |
- **Feminino** (`AR11`):
  | Faixa | TMB |
  |---|---|
  | 3–9 | `(0.063·P + 2.466)·239` |
  | 10–17 | `(0.047·P + 2.951)·239` |
  | 18–29 | `(0.048·P + 2.562)·239` |
  | 30–59 | `(0.048·P + 2.448)·239` |

## A8. Cunningham (1980) — linha 12

Usa MLG. Só calcula se `M11` (MLG) preenchida. Mesma fórmula p/ ambos os sexos.

- `TMB = 22·MLG + 500`

## A9. Tinsley — por peso (2018) — linha 13

Mesma fórmula p/ ambos os sexos.

- `TMB = 24.8·P + 10`

## A10. Tinsley — por MLG (2018) — linha 14

Usa MLG. Mesma fórmula p/ ambos os sexos.

- `TMB = 25.9·MLG + 284`

## A11. Katch-McArdle (1996) — linha 17

Usa MLG. Mesma fórmula p/ ambos os sexos.

- `TMB = 370 + 21.6·MLG`

## A12. EER / IOM (2005) — linha 15 (seleciona helper por idade)

`Calc_GastoEnerg` linha 15 escolhe por idade: 3–8 → helper linha 22; 9–18 → linha 23; ≥19 → linha 24.
Usa **PA = `O17`** (coeficiente de atividade multiplicando o termo de peso/altura).
Helpers (colunas `AQ`=Masc / `AR`=Fem), com A em metros = `A/100`:

- **3–8 anos** (`AQ22`/`AR22`):
  - Masc: `EER = 88.5 − 61.9·I + PA·(26.7·P) + 903·(A/100) + 20 + 174`
  - Fem: `EER = 135.3 − 30.8·I + PA·(10·P) + 934·(A/100) + 20 + 198`
- **9–18 anos** (`AQ23`/`AR23`):
  - Masc: `EER = 88.5 − 61.9·I + PA·(26.7·P) + 903·(A/100) + 25 + 140`
  - Fem: `EER = 135.3 − 30.8·I + PA·(10·P) + 934·(A/100) + 25 + 232`
- **≥19 anos / adulto** (`AQ24`/`AR24`):
  - Masc: `EER = 662 − 9.53·I + PA·(15.91·P) + 539.6·(A/100) + 107`
  - Fem: `EER = 354 − 6.91·I + PA·(9.36·P) + 726·(A/100) + 144`

> Os termos `+20/+25` (depósito energético) e `+174/+140/+198/+232` estão **embutidos verbatim** na planilha
> (constantes fixas dentro da soma). Replicar exatamente.

## A13. EER (2023) — linha 16 (seleciona helper por idade)

`Calc_GastoEnerg` linha 16: 3–13 → helper linha 27; 14–18 → linha 28 (fórmula idêntica à 27); ≥19 → linha 29.
Usa **categoria de atividade `F48` ∈ {1,2,3,4}**. Inclui **custo de crescimento** `AQ26`/`AR26` (ver A16).

- **Crianças/adolescentes 3–18** (`AQ27`=`AQ28` / `AR27`=`AR28`):
  - Masc, por categoria PA (`F48`):
    - `F48=1`: `EER = −447.51 + 3.68·I + 13.01·A + 13.15·P + Crescimento`
    - `F48=2`: `EER = 19.12 + 3.68·I + 8.62·A + 20.28·P + Crescimento`
    - `F48=3`: `EER = −388.19 + 3.68·I + 12.66·A + 20.46·P + Crescimento`
    - `F48=4`: `EER = −671.75 + 3.68·I + 15.38·A + 23.25·P + Crescimento`
  - Fem, por categoria PA (`F48`):
    - `F48=1`: `EER = 55.59 − 22.25·I + 8.43·A + 17.07·P + Crescimento`
    - `F48=2`: `EER = −297.54 − 22.25·I + 12.77·A + 14.73·P + Crescimento`
    - `F48=3`: `EER = −189.55 − 22.25·I + 11.74·A + 18.34·P + Crescimento`
    - `F48=4`: `EER = −709.59 − 22.25·I + 18.22·A + 14.25·P + Crescimento`
- **Adulto ≥19** (`AQ29` / `AR29`):
  - Masc:
    - `F48=1`: `EER = 753.07 − 10.83·I + 6.5·A + 14.1·P`
    - `F48=2`: `EER = 581.47 − 10.83·I + 8.3·A + 14.94·P`
    - `F48=3`: `EER = 1004.82 − 10.83·I + 6.52·A + 15.91·P`
    - `F48=4`: `EER = −517.88 − 10.83·I + 15.61·A + 19.11·P`
  - Fem:
    - `F48=1`: `EER = 584.9 − 7.01·I + 5.72·A + 11.71·P`
    - `F48=2`: `EER = 575.77 − 7.01·I + 6.6·A + 12.14·P`
    - `F48=3`: `EER = 710.25 − 7.01·I + 6.54·A + 12.34·P`
    - `F48=4`: `EER = 511.83 − 7.01·I + 9.07·A + 12.56·P`

## A14. Katch-McArdle — ver A11.

## A15. EER Gestante (2023) — linha 18

Só calcula se `Calc_Antropometria!DM48` (semanas de gestação) **> 12**. Usa `F48` (trimestre/atividade)
e adiciona `Calc_Antropometria!DJ28` (depósito energético da gestação) e `9.16·semanas`.
Feminino (`AQ18`), com `SEM` = semanas de gestação = `Calc_Antropometria!DM48`, `DEP` = `Calc_Antropometria!DJ28`:

- `F48=1`: `EER = 1131.2 − 2.04·I + 0.34·A + 12.15·P + 9.16·SEM + DEP`
- `F48=2`: `EER = 693.35 − 2.04·I + 5.73·A + 10.2·P + 9.16·SEM + DEP`
- `F48=3`: `EER = −223.84 − 2.04·I + 13.23·A + 8.15·P + 9.16·SEM + DEP`
- `F48=4`: `EER = −779.72 − 2.04·I + 18.45·A + 8.73·P + 9.16·SEM + DEP`

> `DEP` (`Calc_Antropometria!DJ28`) e `SEM` (`DM48`) são entradas específicas da gestante. O componente exato
> de `DJ28` **não foi aberto** aqui (é um valor de depósito por trimestre) — **verificar em `Calc_Antropometria`
> se for replicar gestante**.

## A16. EER Lactante (2023) — linhas 19 (0–6 m) e 20 (7–12 m)

Base = **EER feminino 2023** (mesma estrutura de A13, por categoria `F48`), escolhendo adolescente (`I<19`)
ou adulto (`I≥19`), e somando a energia do leite:

- **Lactante 0–6 meses** (linha 19 → helpers `AR31` se `I<19`, senão `AR32`):
  - adição de leite: **`+ 540 − 140`** (kcal) sobre a base feminina 2023.
  - Ex. (`F48=1`, adolescente): `EER = 55.59 − 22.25·I + 8.43·A + 17.07·P + 540 − 140`
  - Ex. (`F48=1`, adulta): `EER = 584.9 − 7.01·I + 5.72·A + 11.71·P + 540 − 140`
- **Lactante 7–12 meses** (linha 20 → helpers `AR34` se `I<19`, senão `AR35`):
  - adição de leite: **`+ 380`** (kcal) sobre a base feminina 2023.
  - Ex. (`F48=1`, adulta): `EER = 584.9 − 7.01·I + 5.72·A + 11.71·P + 380`

> As 4 categorias `F48` da base feminina (ver A13) valem integralmente aqui; apenas troca-se o adicional de leite
> (`+540−140` para 0–6 m; `+380` para 7–12 m).

---

## A17. Custo energético de crescimento (helper linha 26)

Somado nas equações EER 2023 (A13) via `AQ26` (Masc) / `AR26` (Fem):
| Idade | Masculino (`AQ26`) | Feminino (`AR26`) |
|---|---|---|
| 3 | 20 | 15 |
| 4–8 | 15 | 15 |
| 9–13 | 25 | 30 |
| 14–18 | 20 | 20 |
| outros | `""` (0) | `""` (0) |

---

## A18. Fator de atividade (PAL) — `Calc_GastoEnerg`

A planilha guarda um catálogo de PAL por protocolo (colunas C–J, linhas 5–45), selecionável por dropdown
(macro-dependente). Os **valores clássicos** aplicados como multiplicador do TMB (Harris-Benedict etc.) são:

| Fator | Classificação |
| ----- | ------------- |
| 1.2   | Sedentário    |
| 1.375 | Leve          |
| 1.55  | Moderada      |
| 1.725 | Intensa       |
| 1.9   | Muito intensa |

Tabela auxiliar de seleção (linhas 42–45, col F=índice, G=valor): `1→1.2`, `2→1.375`, `3→1.55`, `4→1.725`.

> **Atenção**: cada protocolo tem seu próprio conjunto de PAL (as colunas G/H masc e I/J fem mudam por linha/protocolo,
> incluindo valores como 1.0, 1.11, 1.13, 1.16, 1.26, 1.42, 1.56, etc. e categorias "Pouco ativo/Ativo/Muito ativo").
> A escolha de qual conjunto usar é **dirigida por macro VBA** (dropdown do protocolo). Para EER 2005 usa-se o
> coeficiente `O17` (PA multiplicativo); para EER 2023/adulto usa-se a **categoria `F48` ∈ {1..4}** (não multiplicador).

**GET (Gasto Energético Total)** = `TMB(protocolo) × PAL × Fator de Injúria`. (composição; ver A19 para FI.)

---

## A19. Fator de Injúria (FI) — `Calc_GastoEnerg` colunas X/Y/Z/AA, linhas 5–31

Multiplica o TMB/GET em condições clínicas. `Z` = faixa (texto); `AA` = **FI médio** (valor numérico usado).

| #   | Condição clínica                   | Faixa FI  | FI médio |
| --- | ---------------------------------- | --------- | -------- |
| 1   | Paciente não complicado            | 1         | 1.0      |
| 2   | Câncer                             | 1,1–1,45  | 1.275    |
| 3   | Cirurgia eletiva                   | 1,0–1,1   | 1.05     |
| 4   | Desnutrição grave                  | 1,5       | 1.5      |
| 5   | Doença cardiopulmonar              | 0,8–1,0   | 0.9      |
| 6   | Doença cardiopulmonar com cirurgia | 1,3–1,55  | 1.425    |
| 7   | Fratura                            | 1,2       | 1.2      |
| 8   | Fraturas múltiplas                 | 1,2–1,35  | 1.275    |
| 9   | Infecção grave                     | 1,3–1,35  | 1.325    |
| 10  | Insuficiência cardíaca             | 1,3–1,5   | 1.4      |
| 11  | Insuficiência hepática             | 1,3–1,55  | 1.425    |
| 12  | Insuficiência renal aguda          | 1,3       | 1.3      |
| 13  | Jejum ou inanição                  | 0,85–1,0  | 0.925    |
| 14  | Multitrauma (reabilitação)         | 1,5       | 1.5      |
| 15  | Multitrauma + sepse                | 1,6       | 1.6      |
| 16  | Pequena cirurgia                   | 1,2       | 1.2      |
| 17  | Pequeno trauma de tecido           | 1,14–1,37 | 1.255    |
| 18  | Peritonite                         | 1,2–1,5   | 1.35     |
| 19  | PO cirurgia cardíaca               | 1,2–1,5   | 1.35     |
| 20  | PO cirurgia geral                  | 1,0–1,5   | 1.25     |
| 21  | Pós-operatório                     | 1,1       | 1.1      |
| 22  | Queimadura 30 a 50%                | 1,7       | 1.7      |
| 23  | Queimadura 50 a 70%                | 1,8       | 1.8      |
| 24  | Queimadura 70 a 90%                | 2         | 2.0      |
| 25  | Queimadura até 20%                 | 1,0–1,5   | 1.25     |
| 26  | Sepse                              | 1,1–1,8   | 1.45     |
| 27  | Transplante de fígado              | 1,2–1,5   | 1.35     |

---

## A20. Catálogo de atividades / METs

`Calc_GastoEnerg` colunas N/O/P (Grupo / Atividade / MET) e S/T/U — **centenas** de atividades com valor MET
(ex.: "Aeróbia, alto impacto = 7", "Andar de skate = 5", "Artes marciais moderado = 10.3"). É uma tabela de
lookup (não uma fórmula). Se necessário replicar, extrair a lista completa das colunas N:P da sheet9. Não
transcrita integralmente aqui (dado de catálogo, não equação).

---

# B) ANTROPOMETRIA — 10 protocolos (dobras → densidade → % gordura)

Fonte: `Calc_Antropometria` (Evonut sheet8). **Masculino** = linhas 4–13; **Feminino** = linhas 16–25.
Cada protocolo tem: coluna Q = **Σ dobras**, coluna R = **Densidade corporal (Dc)**, coluna S = **% Gordura**.

**Conversão Dc → % Gordura**: **Siri (1961)** (declarado na célula O1):

```
%Gordura = ((4.95 / Dc) − 4.5) × 100     ≡  495/Dc − 450
```

> Brozek **NÃO** é usado (a planilha usa Siri em todos os protocolos baseados em densidade).
> Idade (`I`) nos protocolos vem da célula `S38`/`V38`/... (idade calculada por `YEARFRAC` da data de nascimento `EI`).

## B1. Durnin & Womersley (1974)

Σ = **Bíceps + Tríceps + Subescapular + Suprailíaca** (`DG+DH+DK+DM`).

- **Masculino** (R4): `Dc = 1.1765 − 0.0744·log10(Σ)`
- **Feminino** (R16): `Dc = 1.1567 − 0.0717·log10(Σ)`
- %Gordura = Siri.

## B2. Guedes (1985)

Sítios **diferentes** por sexo:

- **Masculino** (R5): Σ = **Tríceps + Abdominal + Suprailíaca** (`DH+DL+DM`);
  `Dc = 1.17136 − 0.06706·log10(Σ)`
- **Feminino** (R17): Σ = **Subescapular + Suprailíaca + Coxa** (`DK+DM+DO`);
  `Dc = 1.1665 − 0.07063·log10(Σ)`
- %Gordura = Siri. (Excel `LOG()` = base 10.)

## B3. Jackson-Pollock-Ward 3 dobras (1980)

- **Masculino** (R6): Σ = **Peitoral + Abdominal + Coxa** (`DI+DL+DO`);
  `Dc = 1.10938 − 0.0008267·Σ + 0.0000016·Σ² − 0.0002574·I`
- **Feminino** (R18): Σ = **Tríceps + Suprailíaca + Coxa** (`DH+DM+DO`);
  `Dc = 1.0994921 − 0.0009929·Σ + 0.0000023·Σ² − 0.0001392·I`
- %Gordura = Siri.

## B4. Jackson-Pollock-Ward 7 dobras (1980)

Σ = **Tríceps + Peitoral + Axilar média + Subescapular + Abdominal + Suprailíaca + Coxa**
(`DH+DI+DJ+DK+DL+DM+DO`).

- **Masculino** (R7): `Dc = 1.112 − 0.00043499·Σ + 0.00000055·Σ² − 0.00028826·I`
- **Feminino** (R19): `Dc = 1.097 − 0.00046971·Σ + 0.00000056·Σ² − 0.00012828·I`
- %Gordura = Siri.

## B5. Petroski (1995)

Sítios **diferentes** por sexo:

- **Masculino** (R8): Σ = **Tríceps + Subescapular + Suprailíaca + Panturrilha** (`DH+DK+DM+DP`);
  `Dc = 1.1954713 − 0.07513507·log10(Σ) − 0.00041072·I`
- **Feminino** (R20): Σ = **Axilar média + Suprailíaca + Coxa + Panturrilha** (`DJ+DM+DO+DP`);
  `Dc = 1.1954713 − 0.07513507·log10(Σ) − 0.00041072·I`
- %Gordura = Siri. (Mesmos coeficientes; muda o conjunto de dobras.)

## B6. Faulkner (1987)

**Não** passa por densidade — % Gordura **direto** (coluna R contém o %; S vazia).

- **Masculino** (R9): Σ = **Tríceps + Subescapular + Abdominal + Suprailíaca** (`DH+DK+DL+DM`);
  `%Gordura = Σ·0.153 + 5.783`
- **Feminino** (R21): Σ = `DH+DL+DK+DM` (mesmas 4 dobras, ordem diferente na fórmula);
  `%Gordura = Σ·0.153 + 5.783`
- Fórmula idêntica p/ ambos os sexos.

## B7. Weltman & Col. (1988)

**Não** usa dobras — usa **circunferência abdominal (CW)**, peso (CE) e (feminino) altura (CD).
% Gordura **direto**:

- **Masculino** (R10): `%Gordura = 0.31457·CW − 0.10969·P + 10.8336`
- **Feminino** (R22): `%Gordura = 0.11077·CW − 0.17666·A + 0.14354·P + 51.03301`

## B8. McArdle (1992) — crianças/adolescentes (9–16 anos)

Dc depende da faixa etária; usa **Tríceps (DH)** e **Subescapular (DK)** em log10.

- **Masculino** (R11):
  - 9–12 anos: `Dc = 1.108 − 0.027·log10(Tríceps) − 0.038·log10(Subescapular)`
  - 13–16 anos: `Dc = 1.13 − 0.055·log10(Tríceps) − 0.026·log10(Subescapular)`
- **Feminino** (R23):
  - 9–12 anos: `Dc = 1.088 − 0.014·log10(Tríceps) − 0.036·log10(Subescapular)`
  - 13–16 anos: `Dc = 1.114 − 0.031·log10(Tríceps) − 0.041·log10(Subescapular)`
- %Gordura = Siri.

## B9. Slaughter (1988) — crianças/adolescentes (7–18 anos)

Σ = **Tríceps + Subescapular** (`DH+DK`). % Gordura **direto** (não usa Siri).

- **Feminino** (R24):
  - se `Σ > 35`: `%Gordura = 0.546·Σ + 9.7`
  - senão: `%Gordura = 1.33·Σ − 0.013·Σ² − 2.5`
- **Masculino** (R12):
  - se `Σ > 35`: `%Gordura = 0.783·Σ + 1.6`
  - senão: seleciona por **estágio de maturação** (helper linhas 28/30/32, célula `S28`/`S30`/`S32`),
    que é a **média branca/negra** da equação `%Gordura = 1.21·Σ − 0.008·Σ² + C`, com:
    | Estágio | C (branca) | C (usada = média das raças) |
    |---|---|---|
    | Pré-púbere (7–12) | −1.7 (branca) / −3.5 (negra) | `AVERAGE` das duas |
    | Púbere (13–14) | −3.4 (branca) / ... (negra) | `AVERAGE` das duas |
    | Pós-púbere (15–17) | (linha 32) | `AVERAGE` das duas |

> As constantes de maturação masculina de Slaughter estão nas linhas 28–33 (colunas Q–E), agrupadas por
> "raça" (branca/negra) e mediadas por `AVERAGE`. Coeficientes confirmados: `1.21·Σ − 0.008·Σ² − 1.7`
> (pré-púbere branca), `... − 3.5` (pré-púbere negra), `... − 3.4` (púbere branca). Faixas por idade:
> 7–12 → `S28`, 13–14 → `S30`, 15–17 → `S32`.

## B10. Bioimpedância

% Gordura = **entrada direta** do aparelho (`BD_Antropometria!DW`). Sem fórmula (R13/R25 só repassam o valor).

---

## B11. Índices e composição corporal (colunas h–q de `Calc_Antropometria`)

- **IMC** = `P / (A/100)²` (kg/m²). _(Cálculo padrão; célula de IMC referenciada em `u`/BD.)_
- **Razão Cintura/Quadril (RCQ)** (col `p`, só se idade ≥ 20): `RCQ = ROUNDDOWN(Cintura(CV) / Quadril(CX), 2)`
- **Índice de conicidade** (col `q`): `C = (Cintura/100) / (0.109 · √(P / (A/100)))`
- **CMB** (Circunf. muscular do braço) = `CircBraço(CK)·10 − π·Tríceps(DH)` (em mm; ver col i/j)
- **AMB** (Área muscular do braço) ≈ `((CMB)² )/(4π)` corrigida (col i/k) — usa `CMB²/(4π)`; masc −10, fem −6.5
- **AGB** (Área gordurosa do braço): `π·(Tríceps/10)²/4` (col l)
- **Peso ósseo** (col m): `400 · (DiamÚmero(DQ)/100 · DiamFêmur(DS)/100) · (A/100)²`
- **Peso residual** (col n): masc `P·24.1%`, fem `P·20.9%`
- **Massa muscular** (col o): `Peso magro − Peso ósseo − Peso residual` (derivado)

> Fórmulas de composição (CMB/AMB/AGB/peso ósseo/residual/muscular) transcritas do bloco lateral;
> algumas referenciam intermediários (`AO7`, `AP7`, `AS`, `AU`...) — **estrutura confirmada**, mas se for
> replicar com precisão total, reabrir colunas i–o das linhas 4–33 para os intermediários exatos.

---

## B12. Classificação de IMC (colunas t/u/v de `Calc_Antropometria`)

Faixas (adulto) confirmadas nas células:
| Classificação | IMC |
|---|---|
| Magreza Grau I | 17 – 18.49 |
| Eutrofia | 18.5 – 24.99 |
| Sobrepeso | 25 – 29.99 |
| Obesidade Grau II | 35 – 40 |
| (demais graus) | ver tabela — Magreza II/III e Obesidade I/III presentes na coluna |

Há também **pontos de corte para idosos (>60 anos)** (bloco `BY:CH`, linha 16+) e classificação por INDEX/MATCH.
Faixas completas de todos os graus (Magreza II/III, Obesidade I/III) **presentes** mas não integralmente
transcritas — reabrir col u/v linhas 4–13 se precisar da tabela fechada.

## B13. Classificação de RCQ (risco cardiovascular)

Tabela por sexo × faixa etária (colunas à direita, ~`CA:CH`, com "Risco Baixo/Moderado/Alto/Muito Alto").
Ex. (Masculino): 20–29 anos → Baixo ≤0.83, Moderado 0.83–0.88, Alto 0.89–0.94, Muito alto >0.94.
Ex. (Feminino): 20–29 → Baixo ≤0.71, Moderado 0.71–0.77, Alto 0.78–0.82. A tabela completa está nas
linhas 4–14 das colunas de risco; é **lookup**, não fórmula.

---

# C) CASOS-GABARITO (golden)

**NÃO ENCONTRADO — sem par entrada→saída utilizável.**

Ambas as planilhas foram salvas **sem dados de paciente**:

- `BD_GastoEnerg` (Evonut sheet14): linhas de entrada `DD/DE/DF/DG` **vazias**. As saídas em cache de
  `Calc_GastoEnerg` refletem só o termo constante (ex.: Harris-Benedict 84 → `88.36` com P=A=I=0;
  HB19 → `66.5`; Mifflin → `5`; Tinsley peso → `10`). Isso **confirma o cabeamento das fórmulas** (a constante
  bate), mas não é um caso clínico real.
- `BD_Antropometria` (Evonut sheet13): dobras vazias → `Σ = 0` em cache; `Dc` e `%Gordura` retornam `""`.
- `AF..xlsm` (`'Gasto Energético'` sheet32, `'Antropometria'` sheet31): células dirigidas por macro
  (rótulos numéricos), inputs também **vazios**; nenhum resultado numérico de paciente em cache.

**Verificação de sanidade possível** (não é golden clínico, mas serve de teste unitário de constante):

- Harris-Benedict 1984 M, com P=0,A=0,I=0 → `88.36` ✓ (cache `AF5=88.36`)
- Harris-Benedict 1919 M, idem → `66.5` ✓ (cache `AF6=66.5`)
- Mifflin-St Jeor, idem → `5` ✓ ; Tinsley peso → `10` ✓

Para gerar golden reais: abrir a planilha no Excel, preencher um paciente (P/A/I/sexo/dobras) e ler as saídas —
os `<v>` em cache serão então valores clínicos. Hoje não existem no arquivo.

---

# Resumo de cobertura

**Gasto energético — 16/16 equações recuperadas com coeficientes** (Harris-Benedict 1919 e 1984, Mifflin-St Jeor,
FAO/WHO 1985 e 2004, Schofield, Henry-Rees, Cunningham, Tinsley peso, Tinsley MLG, EER/IOM 2005, EER 2023,
Katch-McArdle, EER Gestante 2023, EER Lactante 0–6m e 7–12m). Incertezas: componente `DJ28` (depósito da
gestante) não aberto; catálogo de PAL por protocolo é macro-dependente (valores clássicos documentados).

**Antropometria — 10/10 protocolos recuperados** (Durnin-Womersley, Guedes, JP-Ward 3D, JP-Ward 7D, Petroski,
Faulkner, Weltman, McArdle, Slaughter, Bioimpedância), com Dc + conversão Siri, por sexo. Incertezas menores:
intermediários exatos da composição corporal (CMB/AMB/peso ósseo) e tabelas fechadas de classificação
(IMC graus extremos, RCQ) são **lookup** e estão parcialmente transcritas.

**Golden cases**: NÃO ENCONTRADOS (planilhas sem dados de paciente).

---

## Conferência contra a planilha (2026-08-03)

Fonte: `Evonut.xlsm`, aba `Calc_GastoEnerg`, colunas **AP/AQ/AR** (protocolo,
fórmula masculina, fórmula feminina). As fórmulas foram lidas do XML do
arquivo, não transcritas à mão.

### Batem exatamente, nas duas colunas de sexo

FAO/WHO 1985, FAO/WHO 2004, Schofield, Henry-Rees, Cunningham, Katch-McArdle,
Tinsley (por peso e por MLG).

### Divergiam

| Equação                     | Planilha                                                                                                                                                                         | Sistema (antes)                                                    | Decisão                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Mifflin-St Jeor             | `9,99·P + 6,25·A − 4,92·I ± sexo`                                                                                                                                                | `10·P + 6,25·A − 5·I`                                              | **Corrigido para a planilha.** Ela reproduz o artigo de 1990; a forma 10/5 circula em livro-texto mas não é a publicada. Diferença de ~2 kcal. |
| Harris-Benedict 1919 e 1984 | coeficientes arredondados (13,4 / 4,8 / 5,68)                                                                                                                                    | precisão do artigo (13,397 / 4,799 / 5,677)                        | **Mantida a precisão do artigo** (decisão do usuário). Diferença menor que 1 kcal.                                                             |
| EER/IOM 2005                | fator de atividade multiplica **só o peso**; altura fora do fator; **acréscimo fixo por sexo e faixa** (+107 M / +144 F adulto; +140 M / +232 F em 9–18; +174 M / +198 F em 3–8) | forma publicada: fator multiplica peso **e** altura, sem acréscimo | **Convivem as duas.** A variante da planilha entrou como equação própria (`eer_iom_2005_planilha`), não como comportamento por clínica.        |

### Por que o EER virou equação separada e não regra por clínica

A avaliação nutricional é registro clínico e precisa ser reproduzível. Se duas
clínicas obtivessem kcal diferentes de uma equação com o **mesmo nome**, o
histórico ficaria impossível de auditar: ninguém saberia, olhando um cálculo de
seis meses atrás, qual fórmula o produziu. Com duas entradas nomeadas, o
snapshot da avaliação já diz qual foi usada.

**Tamanho da diferença**: no adulto é de ~129 kcal/dia (peso 80 kg, altura
1,75 m, PA 1,25), porque o termo de altura do adulto é 539,6. Em criança a
distância é bem maior, já que ali o coeficiente é 903.

## Conferência da antropometria (2026-08-03)

Fonte: `Evonut.xlsm`, aba `Calc_Antropometria`. Bloco masculino nas linhas 4–13,
feminino nas 16–25 (as colunas Q/T/W são as avaliações 1 a 7, não os sexos).
Os sítios foram decodificados pelas colunas de `BD_Antropometria`:
DG bíceps · DH tríceps · DI peitoral · DJ axilar média · DK subescapular ·
DL abdominal · DM suprailíaca · DO coxa média · DP panturrilha ·
CW circunferência abdominal · CE peso.

### Sítios: batem todos

Inclusive onde mudam por sexo. Guedes: homem tríceps/abdominal/suprailíaca,
mulher subescapular/suprailíaca/coxa. Jackson-Pollock 3D: homem
peitoral/abdominal/coxa, mulher tríceps/suprailíaca/coxa. Petroski: homem
tríceps/subescapular/suprailíaca/panturrilha, mulher
axilar média/suprailíaca/coxa/panturrilha.

### Densidade: sete batem exatamente

Guedes, Jackson-Pollock 3D, Jackson-Pollock 7D, Faulkner, McArdle, Slaughter
(nos dois sexos) e Siri.

### Três alinhados com a planilha nesta revisão

| Protocolo          | Antes                                            | Agora                                                    |
| ------------------ | ------------------------------------------------ | -------------------------------------------------------- |
| Durnin & Womersley | coeficiente por faixa etária (5 faixas por sexo) | coeficiente agrupado, um por sexo (1,1765 H / 1,1567 M)  |
| Petroski           | quadrática no homem, logarítmica na mulher       | a MESMA logarítmica nos dois sexos; só os sítios diferem |
| Weltman            | duas circunferências abdominais, com média       | uma única circunferência                                 |

As três vinham da conferência de literatura de julho, que tratou a forma da
planilha como imprecisão. A decisão de 2026-08-03 foi o contrário: o documento
de base manda, porque é contra ele que a profissional confere os números à mão.
Os coeficientes por faixa etária do Durnin ficaram no código, sem uso e
nomeados como tal, para a alternativa não se perder.

## Fatores de atividade e injúria (2026-08-03)

### Atividade — batem

Escala clássica (não-EER): 1,2 · 1,375 · 1,55 · 1,725 · 1,9. Idêntica à coluna
da planilha.

Níveis do EER, por sexo e faixa etária, também idênticos:
adulto homem 1,0 / 1,11 / 1,25 / 1,48 · adulto mulher 1,0 / 1,12 / 1,27 / 1,45 ·
3 a 18 homem 1,0 / 1,13 / 1,26 / 1,42 · 3 a 18 mulher 1,0 / 1,16 / 1,31 / 1,56.

**Pendência**: a planilha tem uma SEGUNDA escala de atividade (1,55 leve ·
1,85 moderada · 2,2 intensa), que o sistema não oferece. Precisa de decisão
sobre a qual equação ela se aplica.

### Injúria — corrigido

O documento lista **25 condições clínicas** com faixa e valor médio. O sistema
tinha 17, agrupava condições distintas na mesma linha e **omitia quatro**:
doença cardiopulmonar (0,9), jejum ou inanição (0,925), pequeno trauma de
tecido (1,255) e PO cirurgia cardíaca (1,35).

As duas primeiras são as **únicas com fator abaixo de 1** — os casos em que o
gasto DIMINUI. Sem elas o cálculo só sabia aumentar.

Pior que a lista incompleta: **não havia campo na tela**. O fator existia no
motor e na rota desde a 046, mas a profissional não tinha como escolher. Agora
há um seletor com as 25 condições, mostrando o valor e a faixa publicada.

## Classificações (2026-08-03)

### IMC e relação cintura-quadril — batem

IMC adulto na tabela da OMS (16 · 17 · 18,5 · 25 · 30 · 35 · 40) e a faixa de
idoso acima de 60 anos (Lipschitz: magreza < 22 · eutrofia 22–27 ·
sobrepeso > 27). Idênticos ao documento.

Relação cintura-quadril: as **10 faixas** (5 etárias × 2 sexos) conferem valor a
valor. Homem 20–29: 0,83 / 0,88 / 0,94 … 60–69: 0,91 / 0,98 / 1,03. Mulher
20–29: 0,71 / 0,77 / 0,82 … 60–69: 0,76 / 0,83 / 0,90.

Nota: a tabela publicada vai de 20 a 69 anos e o sistema estende a última faixa
para idades acima de 69.

### %gordura — FALTAVA por inteiro

O documento traz a classificação de **Pollock & Wilmore (1993)** por sexo e
faixa etária (18–25 · 26–35 · 36–45 · 46–55 · 56–65), com sete faixas:
excelente · bom · melhor que a média · média · acima da média · ruim ·
muito ruim.

O sistema calculava o percentual de gordura e **não dizia o que ele significa** —
a profissional tinha de consultar a tabela por fora, que é justamente o
trabalho que o software deveria poupar. Implementado em `classifyBodyFat` e
exibido ao lado do valor.

Fora de 18 a 65 anos devolve nada, em vez de esticar a faixa mais próxima:
extrapolar referência de composição corporal é inventar diagnóstico.

---

## O que a planilha tem e o sistema ainda não (2026-08-03)

Levantamento por aba, nos dois arquivos.

### Já coberto pelo sistema

Anamnese · recordatório R24h · resultado de exames com faixa · antropometria e
dobras · gasto energético · definição de metas · plano alimentar · listas de
equivalência · cadastro de alimentos e medidas caseiras · rótulo nutricional ·
orientações · percentis de crescimento · DRIs · documentos do paciente ·
materiais · agendamentos · dados da clínica.

### Falta

1. **Impressos da consulta.** A AF tem NOVE abas de impressão (anamnese,
   recordatório, exames, antropometria, bioimpedância, avaliação infantil,
   avaliação gestacional, plano alimentar, orientações) e a Evonut tem
   `BD_Entregaveis` 1 a 3 mais a tela Entregáveis. O sistema só exporta o
   rótulo. É o maior buraco: a nutricionista entrega papel ao paciente.

2. **Pedido de exames.** `BD_PedidoExames` guarda `Data Pedido` e
   `Data Resultado` — ou seja, solicita e depois lança o resultado.
   `BD_Cad_Pedidos` é o catálogo de exames para montar o pedido. O sistema
   (050) só registra resultado. Isto já tinha sido declarado fora do escopo v1.

3. **Plano alimentar por dia da semana.** `BD_DiasSemana` tem uma coluna por
   dia (Dom a Sáb) por atendimento. O plano do sistema é de um dia só. A aba
   está vazia neste arquivo, então é capacidade da planilha, não
   necessariamente uso corrente — confirmar com a profissional.

4. **Prescrições estruturadas.** `BD_Prescrições` guarda descrição, **tipo** e
   **categoria** além do texto. O sistema tem receituário (Memed) e orientações
   em texto livre, mas não uma prescrição classificada.

5. **Avaliação gestacional e infantil como fluxo próprio.** As equações existem
   (EER gestante e lactante) e as curvas de crescimento entraram, mas a
   planilha trata cada uma como entregável com impresso dedicado.

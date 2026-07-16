# Research — Avaliação Nutricional (046)

Todas as incógnitas de escopo foram resolvidas com o solicitante antes deste plano. Consolidação:

## D1 — Cobertura de métodos

- **Decisão**: oferecer **todas** as equações de gasto energético (16) e **todos** os protocolos de composição (10) das planilhas de referência, não um subconjunto.
- **Racional**: o solicitante prioriza paridade com as planilhas que a nutricionista já usa; cada método extra é apenas mais um conjunto de coeficientes sobre a mesma arquitetura.
- **Alternativas consideradas**: subconjunto núcleo (6+6) — rejeitado por não bater com o fluxo atual da profissional.

## D2 — Fonte da verdade dos coeficientes

- **Decisão**: os coeficientes vêm de `nutri-doc/formulas-referencia.md` (engenharia reversa das planilhas `Evonut.xlsm`/`AF..xlsm`, abas `Calc_*`). Onde a planilha diverge **claramente** do publicado (ex.: Mifflin `9.99`/`4.92`), usar os **valores canônicos publicados**; a planilha é autoridade para **estrutura** (faixas etárias, sítios de dobra, adicionais gestante/lactante, PAL, fator injúria).
- **Racional**: garantir "números batendo" com fidelidade clínica, sem replicar erros de digitação do autor da planilha (decisão do usuário: canônico onde há desvio claro).
- **Conversão densidade→%gordura**: **Siri** `%G = (495/Dc) − 450` — a planilha declara Siri (Brozek não é usada).
- **Pendência técnica**: reconferir a **EER/IOM 2005** célula a célula (parentização de PA sobre peso+altura e o termo aditivo `+107/+144`) antes de codar essa equação.

## D3 — Casos-gabarito dos testes

- **Decisão**: gerar os valores-gabarito **a partir das fórmulas transcritas** (autoconsistentes) e validar por amostragem manual.
- **Racional**: as planilhas foram salvas **sem** dados de paciente (só confirmam os termos constantes), então não há par entrada→saída clínico real. Opção futura: o usuário preenche exemplos no Excel para virarem gabaritos reais.

## D4 — Armazenamento

- **Decisão**: **tabela dedicada `nutrition_assessments`** (snapshot imutável da consulta) **que alimenta o motor de medições** (`patient_measurements`) com os derivados.
- **Racional**: preserva o "retrato" da consulta (quais dobras, qual protocolo, quais fatores) E dá evolução dos indicadores reaproveitando gráficos/metas/portal já existentes. Mesma escolha das features de exame (odonto/perio).
- **Alternativas**: só calculadora gravando métricas — rejeitada por perder o retrato da consulta.

## D5 — UI

- **Decisão**: **tela própria no menu** (`/operacao/avaliacao-nutricional`), com seleção de paciente → formulário → resultado ao vivo → salvar → histórico.
- **Racional**: escolha do usuário; dá destaque à avaliação. O cálculo ao vivo reusa o motor puro no cliente (isomórfico), sem endpoint extra.

## D6 — Reuso de infraestrutura

- **Motor de medições (feature 030)**: derivados (%gordura, massa magra/gorda, IMC, TMB, GET) gravados via `recordMeasurementsBatch`. Métrica nova **`gasto_energetico_total`** (kcal) acrescentada ao catálogo `patient_metric_types` — atenção ao mecanismo `catalog_baseline` (migration 0170) que restaura catálogos nos testes (inserir também no baseline, como feito na bioimpedância).
- **Metas**: `patient_metric_goals` (peso-alvo, %gordura-alvo). Meta de VET/macros fica na avaliação.
- **Gating/RBAC**: `hasModule('nutri_avaliacao')` + `requireRole(['admin','profissional_saude'])`.
- **Persistência imutável**: RPC `SECURITY DEFINER` + trigger append-only (padrão perio/odonto) + `log_audit_event`.

## Sem novas dependências

O motor de cálculo é aritmético puro (potências, log10) — nada além do que já existe. Gráficos via `recharts` já presente. Nenhuma lib de nutrição/estatística é necessária.

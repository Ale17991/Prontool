# Phase 0 — Research: Faturamento TISS

Resolve as incógnitas técnicas do plano. Cada decisão: **Decisão / Justificativa / Alternativas**.

## R1. Versão TISS-alvo

- **Decisão**: Componente de **Comunicação 04.03.00** (mensagens) + Conteúdo e Estrutura **202511** + Representação/TUSS **202605** + Segurança e Privacidade **202511**.
- **Justificativa**: confirmado no PDF oficial `PadroTISS_ComponenteOrganizacional_202605.pdf` (release **Maio/2026**, o mais recente — pub. 28/05/2026), seção XII–Prazos (item 314): Comunicação 04.03.00, fim de implantação 30/06/2026. RN 501/2022 Art. 7 obriga "versão vigente". O Maio/2026 atualizou só tabelas TUSS (19/20/64), não o XML de mensagens → 04.03.00 segue vigente.
- **Alternativas**: 4.01/4.02 (refutadas na pesquisa — desatualizadas); 01.06.00 (é só Monitoramento, não substitui mensagens).
- **Ação no /plan→tasks**: baixar o `.zip` do Componente de Comunicação 04.03.00 da página do release (com user-agent de browser — gov.br dá 403 a clientes não-browser), extrair os `.xsd` e commitar em `src/lib/core/tiss/schemas/04.03.00/`.

## R2. Validação XML × XSD em serverless (Vercel)

- **Decisão**: `xmllint-wasm` (libxml2 compilado para WebAssembly).
- **Justificativa**: sem binários nativos → roda no runtime Node da Vercel sem etapa de compilação; suporta validação contra XSD com imports/includes (o TISS usa `tissSimpleTypes…` importado). Erros retornam linha/coluna → traduzimos em mensagens legíveis por campo.
- **Alternativas**: `libxmljs2-xsd` (binding nativo — risco de build/empacotamento em serverless); `xsd-schema-validator`/`node-xsd-schema-validator` (spawnam um validador **Java** — inviável na Vercel).
- **Risco/verificação**: confirmar que `xmllint-wasm` resolve corretamente os `xsd:import` entre os arquivos do pacote 04.03.00 (carregar todos os XSDs do diretório como `preload`). Coberto pelo teste-âncora `tiss-xml-validates-against-xsd`.

## R3. Assinatura digital (XMLDSig) com ICP-Brasil

- **Decisão**: `xml-crypto` para **XMLDSig enveloped RSA-SHA256**; certificado **A1 (.pfx/.p12)** lido com `node-forge` (→ PEM + cadeia). Certificado e senha cifrados em `tenant_tiss_certificates` via `enc_text_with_key`. Assinatura aplicada ao `mensagemTISS` do lote, server-side, no momento do download.
- **Justificativa**: `xml-crypto` (node-saml) é a lib madura de XMLDSig em Node (enveloped transform, SHA-256, canonicalização). A1 é arquivo → assinável no servidor. ICP-Brasil A1 é X.509 RSA padrão.
- **Alternativas**: A3 (token/cartão) — não assinável server-side sem presença física/HSM (follow-up); `xmldsigjs` (Web Crypto) — viável, mas `xml-crypto` tem mais tração e exemplos.
- **Pendência p/ tasks**: ler no **Componente de Segurança e Privacidade 202511** o detalhe exato exigido (algoritmo de digest/canonicalização aceito, se a assinatura é por guia ou por lote/mensagem, KeyInfo com a cadeia). Ajustar `sign-lote.ts` ao que o XSD/componente especifica antes de marcar US4 pronta.

## R4. Construção do XML

- **Decisão**: `xmlbuilder2` para montar o XML a partir do modelo normalizado (ordem de elementos e escaping garantidos), com namespace alvo `http://www.ans.gov.br/padroes/tiss/schemas`.
- **Justificativa**: ordem dos elementos importa no XSD (sequence); template string é frágil. `xmlbuilder2` é leve e tipável.
- **Alternativas**: `fast-xml-parser`/string templates (risco de ordem/escaping); gerar via XSLT (overkill).

## R5. Hash de integridade (epílogo)

- **Decisão**: **MD-5** do conteúdo conforme o Componente Organizacional ("HASH MD-5", seção do Componente de Comunicação) — calculado sobre o conteúdo da mensagem na forma definida pela ANS, gravado no `epilogo`.
- **Justificativa**: o PDF Organizacional 202605 lista explicitamente "HASH MD-5" no Componente de Comunicação. `crypto.createHash('md5')` nativo do Node.
- **Pendência p/ tasks**: confirmar no componente a **regra exata de concatenação** dos campos que entram no hash (a ANS define a sequência) — implementar `hash.ts` exatamente assim; cobrir com fixture validado.

## R6. Mapeamento de campos (fonte da verdade)

- **Decisão**: usar a **legenda oficial 202511** (planilha `Componente de Conteúdo e Estrutura_202511.xlsx`, abas `Guia de Consulta` e `Guia de SP SADT`) como fonte dos campos e obrigatoriedade; domínios confirmados: Conselho **26**, CBO **24**, UF **59**, Indicação de Acidente **36**, Tipo de Consulta **52**, Tabela de procedimento **87**, Técnica (SP/SADT) **48**, Caráter do Atendimento **23**, Tipo de Atendimento **50**, Regime **76**, Grau de Participação **35**, Tabela 38 (glosas).
- **Justificativa**: corrige erros da pesquisa inicial (eram 53/35/49). Detalhado em `contracts/tiss-xml-contract.md`.

## R7. Origem dos dados (reuso do schema existente)

Mapa confirmado por exploração do código (reuso, sem duplicar):
- **Beneficiário**: `patients` (PII em `_enc`); decifrar via `get_patient_for_tenant(tenant, patient, key)`. **Gap**: não há campo de **número da carteira do convênio** no paciente → precisa ser capturado (decisão D-data, ver data-model: coluna nova cifrada em `patients` OU vínculo paciente×plano). 
- **Executante/solicitante**: `doctors` (`cpf`, `council_state`=UF, `council_name`/`council_number`, `crm`); **CBO** não existe em `doctors` → capturar (coluna nova ou na config do médico).
- **Procedimentos/valores**: `appointment_procedures` (linhas, `line_amount_cents`) + `tuss_codes` (code/description/tuss_table/valid_to). Valor efetivo via `appointments_effective.net_amount_cents`.
- **Operadora**: `health_plans` (+ nova `tenant_tiss_operator_config` para Registro ANS, código do contratado, CNPJ/CNES).
- **Financeiro/repasse**: feature 023 (`monthly_payouts`, `installment_payments`) para US6.

## R8. Gaps de dados que viram requisito de captura (decisão humana leve)

Estes campos são **obrigatórios na guia** e **não existem hoje** — o data-model decide onde capturá-los; nenhum bloqueia o desenho, mas precisam existir antes de gerar guia válida:
1. **Número da carteira do beneficiário** (Consulta campo 4 / SP-SADT) — sugerido: coluna cifrada `health_plan_card_enc` + validade em `patients`, ou tabela `patient_health_plan_cards` (paciente pode ter carteira por operadora). **Recomendação**: tabela `patient_health_plan_cards` (1 paciente × N convênios).
2. **CBO do profissional** (dom. 24) — sugerido: coluna `cbo` em `doctors` (texto, dom. 24).
3. **CNES do contratado** (Consulta campo 11) — na `tenant_tiss_operator_config` (por operadora) ou perfil da clínica; `9999999` se não houver.

> Estes três entram como sub-tarefas de captura na Fase B/C; ver data-model.

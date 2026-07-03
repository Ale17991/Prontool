# Schemas TISS 04.03.00 — origem

**Componente de Comunicação 04.03.00** (mensagens) + 01.06.00 (monitoramento) do Padrão TISS da ANS.

- **Origem**: release oficial ANS **Janeiro/2026** (a 04.03.00 segue vigente no release Maio/2026; o release só atualizou tabelas TUSS, não o XML de mensagens).
- **URL de download** (zip): `https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/copy3_of_PadroTISSComunicao_202511.zip`
  - Rótulo na página: "Baixar Componente de Comunicação.(.zip)" — a página Janeiro/2026 declara este arquivo como versões **04.03.00 e 01.06.00**. (O nome do arquivo `...202511.zip` é genérico/reusado pela ANS; o conteúdo é 04.03.00, confirmado pelos nomes `*V4_03_00.xsd`.)
  - gov.br responde **403** a clientes sem user-agent de browser — baixar com UA de navegador.
- **Baixado em**: 2026-06-02.
- **Fim de implantação obrigatório da 04.03.00**: 30/06/2026.

## Arquivos (mensagens 04.03.00)

- `tissV4_03_00.xsd` — schema raiz (`mensagemTISS`).
- `tissGuiasV4_03_00.xsd` — tipos das guias (Consulta, SP/SADT, etc.).
- `tissComplexTypesV4_03_00.xsd` / `tissSimpleTypesV4_03_00.xsd` — tipos.
- `tissWebServicesV4_03_00.xsd` — operações de webservice (fora do MVP, mantido p/ resolver imports).
- `tissAssinaturaDigital_v1.01.xsd` + `xmldsig-core-schema.xsd` — **assinatura digital** (referência p/ T034).
- `*MonitoramentoV1_06_00.xsd` — Componente de Monitoramento (não usado no MVP; mantido p/ imports).

## Atualização

Ao subir um novo release ANS que altere o Componente de Comunicação: criar `schemas/<nova-versão>/`, baixar os XSDs, e atualizar `src/lib/core/tiss/version.ts` na mesma PR.

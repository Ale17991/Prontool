# TUSS Tabela 38 — Motivos de Glosa (CodeSystem oficial ANS)

- **Arquivo**: `CodeSystem-tuss-38.json`
- **Fonte**: FHIR CodeSystem oficial da ANS — `https://fhir-hm.ans.gov.br/CodeSystem-tuss-38.json`
  (página humana: `https://fhir-hm.ans.gov.br/CodeSystem-tuss-38.html`)
- **`CodeSystem.url`**: `https://fhir.ans.gov.br/CodeSystem/tuss-38`
- **`CodeSystem.version`**: `202309`
- **Conteúdo**: 639 conceitos, cada um `{ code (4 dígitos), display }`.
- **Baixado com**: `curl` + User-Agent de browser (gov.br rejeita clientes não-browser).

## Como é usado

`scripts/seed-tuss-38.ts` (`pnpm seed:tuss-38`) lê `concept[]` deste JSON e faz
upsert em `public.tiss_domain_tables` sob `domain_number = '38'` (idempotente,
`ON CONFLICT DO NOTHING`). A validação de motivo de glosa
(`src/lib/core/tiss/glosa.ts::validateMotivo`) passa a exigir pertinência a este
domínio quando ele está semeado; a faixa **9901–9999** (motivos próprios da
operadora) é sempre aceita e não precisa estar nesta tabela.

`tiss_domain_tables` não tem `tenant_id` (catálogo global) e não é truncada pelos
testes — o seed persiste após `resetDatabase()`. O CI/ambiente novo deve rodar
`pnpm seed:tuss-38` (junto de `seed:tiss-domains`).

## Atualização a cada release ANS

Ao subir de versão da Tabela 38, rebaixar o JSON da mesma URL, conferir o novo
`version`, atualizar este SOURCE.md e re-rodar o seed (novos códigos entram;
existentes são ignorados por conflito).

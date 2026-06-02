# Quickstart — Faturamento TISS (dev/validação local)

Pré-requisitos: Docker + `supabase start` (:54321), `pnpm install`. Login demo: `admin@clinica-demo.test` / `demo1234`.

> ⚠️ **Não rodar `vitest`/`pnpm test` enquanto testa manualmente** — `resetDatabase()` apaga o banco local. Re-seed: `pnpm seed:demo`.

## 1. Preparar schema e dados
```bash
pnpm supabase:reset            # aplica migrations incl. 0112_tiss_faturamento.sql
pnpm supabase:gen-types        # regenera tipos do banco
pnpm seed:demo                 # tenant + usuários demo
pnpm seed:tuss                 # catálogo TUSS (procedimentos tabela 22)
# seed dos domínios TISS (38/87/26/24/59/52/36/48/50/23/76/35) roda na migration
```

## 2. XSDs oficiais 04.03.00 (asset versionado)
Baixar o `.zip` do Componente de Comunicação 04.03.00 da página do release (Maio/2026) usando user-agent de browser (gov.br dá 403 a clientes não-browser), extrair os `.xsd` para `src/lib/core/tiss/schemas/04.03.00/` e commitar. O teste-âncora `tiss-xml-validates-against-xsd` falha se o diretório estiver vazio/incompleto.

## 3. Certificado de teste (A1)
Para dev, gerar um A1 self-signed (.pfx) — a assinatura XMLDSig é exercitável sem cadeia ICP real; a validação de cadeia ICP-Brasil é cobrança da operadora, não do XSD. Subir em `/configuracoes/integracoes/tiss` (admin).

## 4. Fluxo ponta a ponta (MVP A+B+C+D)
1. **Config operadora** (admin): `/configuracoes/integracoes/tiss` → habilitar TISS num convênio (Registro ANS, código do contratado, CNPJ/CNES).
2. **Certificado** (admin): subir o `.pfx` + senha.
3. **Gerar guia** (faturista): num atendimento de consulta → "Gerar guia TISS" → ver campos preenchidos; se faltar carteira/CBO, ver pendências claras.
4. **Lote + assinar + exportar**: agrupar guias `pronta` da operadora → fechar lote → baixar XML → validar.

## 5. Validar o XML manualmente
- O download deve abrir sem erro e **validar contra o XSD** (o sistema já valida antes de liberar; para conferência externa, usar o Validador TISS público ou `xmllint --schema`).
- Conferir: `numeroLote` presente, `epilogo/hash` (MD-5) presente, `Signature` presente.

## 6. Testes (quando NÃO estiver testando manualmente)
```bash
pnpm test:contract      # isolamento, RBAC, append-only, XML×XSD (âncora)
pnpm test:integration   # geração consulta/sp-sadt, validação bloqueia incompleto, lote+assinatura, glosa+reapresentação
pnpm typecheck && pnpm lint:auth
```

## Critérios de aceite (espelham Success Criteria)
- SC-001: 100% dos XMLs gerados validam no XSD 04.03.00.
- SC-003: guia com campo obrigatório faltando **não** entra em lote nem exporta.
- SC-004: pendências listadas campo a campo (sem mensagem genérica).
- SC-005: lote reproduz mesmo conteúdo/hash no re-download; versão TISS/catálogo e autor auditáveis.
- SC-006: nenhum dado TISS visível entre tenants (teste de contrato).

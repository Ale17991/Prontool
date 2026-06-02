# Contract — XML TISS 04.03.00 (mapeamento campo → XSD)

Fonte da verdade: **XSDs oficiais 04.03.00** (`schemas/04.03.00/`) + legenda **Conteúdo e Estrutura 202511**. Namespace alvo: `http://www.ans.gov.br/padroes/tiss/schemas`.

## Estrutura da mensagem/lote
```
mensagemTISS
├── cabecalho (cabecalhoTransacao): identificação transação, origem/destino, versão 04.03.00, data/hora
├── prestadorParaOperadora
│   └── loteGuias (ans:ctm_guiaLote)
│       ├── numeroLote
│       └── guiasTISS
│           ├── guiaConsulta*        (US2)
│           └── guiaSP-SADT*         (US3)
├── epilogo
│   └── hash (MD-5)                  (R5)
└── Signature (XMLDSig enveloped, opcional no XSD; OBRIGATÓRIA no nosso MVP — D2)
```
- Um lote = **uma operadora**, **um tenant**. `numeroLote` = `tiss_lotes.lote_number`.

## Guia de Consulta — campos (obrigatoriedade da legenda 202511)
| Campo | Obrig. | Origem no sistema | Domínio |
|------|--------|-------------------|---------|
| Registro ANS | SIM | `tenant_tiss_operator_config.ans_registration` | — |
| Nº guia no prestador | SIM | `tiss_guias.guia_number_prestador` | — |
| Nº carteira beneficiário | SIM | `patient_health_plan_cards.card_number_enc` | — |
| Atendimento a RN (S/N) | SIM | atendimento/paciente (default 'N') | — |
| Nome do beneficiário | SIM | `patients.full_name_enc` (decifrado server-side) | — |
| Código contratado executante | SIM | `tenant_tiss_operator_config.contracted_code` | — |
| Nome do contratado | SIM | perfil da clínica / config | — |
| CNES | SIM (`9999999` se n/a) | `contracted_cnes` | — |
| Conselho profissional | SIM | `doctors.council_name` | 26 |
| Número no conselho | SIM | `doctors.council_number` | — |
| UF do conselho | SIM | `doctors.council_state` | 59 |
| CBO | SIM | `doctors.cbo` (novo) | 24 |
| Indicação de acidente | SIM | atendimento (default '9' não aplicável) | 36 |
| Regime de atendimento | SIM | config/atendimento | 76 |
| Data do atendimento | SIM | `appointments.appointment_at` (data, fuso clínica) | — |
| Tipo de consulta | SIM | atendimento | 52 |
| Tabela + Código procedimento | SIM | `tiss_guia_procedures.tuss_table`+`procedure_code` | 87 |
| Valor do procedimento | SIM (0 se s/ contrato) | `unit_amount_cents` → reais | — |
| Assinatura prof. executante / beneficiário | SIM | campo de assinatura (presencial/eletrônico) | — |
| **Condicionados** | | | |
| Nome do profissional executante | quando contratado = **PJ** | `doctors.full_name` | — |
| Cobertura especial | condic. | atendimento | 75 |
| Validade da carteira / Nº guia operadora / Nome social | condic. | quando aplicável | — |

## Guia SP/SADT — específicos (legenda 202511)
- **Bloco Solicitante**: Conselho(26)/Número/UF(59)/CBO(24) do solicitante + Assinatura.
- **Bloco Executante**: idem por linha quando há honorários (Grau de Participação dom. 35).
- Cabeçalho: Caráter do Atendimento (23), Tipo de Atendimento (50), Indicação de Acidente (36), Tipo de Consulta (52, se atendimento=consulta), Senha (condic.).
- **Linha de procedimento realizado**: Tabela (87) + Código + Descrição + Qtde + Via de acesso (cirúrgico) + Técnica (48) + Valor Unitário + Valor Total.
- **Totalizadores**: procedimentos, taxas/aluguéis, materiais, OPME, medicamentos, gases.

## Regras de validação (antes do XSD — `validate-content`)
- Todo procedimento tem par `tuss_table`+`procedure_code` (nunca texto livre).
- Código TUSS pertence à versão de catálogo vigente (`tuss_codes.valid_to` nulo/futuro) — senão pendência.
- Valores ≥ 0; quantidade ≥ 1.
- Campos SIM presentes conforme tabela; PF/PJ aplica regra condicional do executante.
- Falha → `validation_errors[]` com `{ field, message }` legível (espelha o bloqueio de prescrição da Memed).

## Validação XSD (`validate.ts`)
- Carrega todos os `.xsd` de `schemas/04.03.00/` (com imports) no `xmllint-wasm`; valida a `mensagemTISS` completa do lote. Erros de linha/coluna → traduzidos.

## Assinatura (`sign-lote.ts`)
- XMLDSig **enveloped**, RSA-SHA256, canonicalização exclusiva; `KeyInfo` com o certificado A1 (cadeia ICP-Brasil). Aplicada após hash, sobre o `mensagemTISS`. **Confirmar no Componente de Segurança e Privacidade 202511** o algoritmo/forma exigidos antes de fechar US4.

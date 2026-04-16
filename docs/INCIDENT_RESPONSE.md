# 🚨 Plano de Resposta a Incidentes de Segurança e Privacidade (LGPD)

**Organização:** Hezi Tech
**Documento:** Runbook de Resposta a Incidentes e Notificação de Vazamentos
**Conformidade:** Artigos 46, 48 e 50 da Lei Geral de Proteção de Dados (Lei nº 13.709/2018)

Este documento estabelece o protocolo oficial da Hezi Tech para detecção, contenção e comunicação de incidentes de segurança que envolvam dados pessoais dos titulares (jogadores, administradores e torcedores).

---

## 1. Classificação de Incidentes (Severidade)

Todo evento anômalo deve ser classificado imediatamente em um dos quatro níveis abaixo para determinar o Tempo de Resposta (SLA) e a necessidade de acionamento jurídico.

### 🔴 P1 - Crítico (Vazamento Confirmado)

- **Descrição:** Exfiltração confirmada do banco de dados (PostgreSQL), acesso indevido a PII (Personally Identifiable Information) em massa, ou comprometimento da chave de criptografia (`DATA_ENCRYPTION_KEY`).
- **Ação Imediata:** Bloquear acesso ao banco, rotacionar credenciais de infraestrutura e acionar comitê de crise.
- **SLA LGPD:** Notificação à ANPD e aos titulares em até **2 dias úteis**.

### 🟠 P2 - Alto (Comprometimento de Acesso Privilegiado)

- **Descrição:** Credenciais de um usuário `SUPER_ADMIN` ou `ADMIN` foram comprometidas, ou acesso indevido ao painel administrativo confirmado, com potencial acesso a dados de terceiros.
- **Ação Imediata:** Invalidar sessões (`tokenVersion++`), forçar reset de senha e revogar 2FA da conta afetada. Analisar `AuditLog` para mensurar o impacto.

### 🟡 P3 - Médio (Vulnerabilidade Exposta)

- **Descrição:** Descoberta de vulnerabilidade crítica no código (ex: falha de CSRF, XSS bypassando o DOMPurify) em ambiente de produção, mas **sem evidência de exploração ativa**.
- **Ação Imediata:** Patch de correção em até 24h, deploy emergencial e revisão dos logs de auditoria dos últimos 7 dias.

### 🟢 P4 - Baixo (Ataque Bloqueado)

- **Descrição:** Picos de tráfego anômalo mitigados pelo Upstash Redis (Rate Limiting), falhas de autenticação em massa bloqueadas, ou tentativas de injeção de SQL/XSS barradas pelas defesas.
- **Ação Imediata:** Monitoramento passivo. Nenhum acionamento de crise necessário.

---

## 2. Fluxo de Resposta a Incidentes

A Hezi Tech adota o modelo de 5 fases para resposta a incidentes:

1. **Detecção e Análise:** Monitoramento de logs de erro do Next.js, alertas do provedor de banco de dados e denúncias de usuários.
2. **Contenção (Curto Prazo):** Isolar o sistema afetado. Isso pode incluir ativar o "Maintenance Mode" na Vercel ou rotacionar chaves de banco de dados instantaneamente.
3. **Erradicação:** Remover o vetor de ataque. Fazer deploy do patch de segurança, limpar arquivos maliciosos ou bloquear IPs na borda (WAF).
4. **Recuperação:** Restaurar os serviços a partir de um backup seguro (se aplicável), invalidar todos os tokens JWT globalmente e reiniciar a operação monitorada.
5. **Lições Aprendidas (Post-Mortem):** Reunião técnica em até 7 dias após o incidente para documentar a falha e implementar novos `Guards` ou regras de infraestrutura.

---

## 3. Ações Específicas por Vetor de Ataque

### A. Vazamento do Banco de Dados (Dump SQL)

1. **Contenção:** Revogar imediatamente a URL de conexão exposta e gerar uma nova credencial no provedor (Supabase/Neon).
2. **Auditoria:** Identificar por qual IP/Serviço o dump foi executado.
3. **Avaliação de Risco:** Como os campos sensíveis (`twoFactorSecret`, `holderDocument`) estão protegidos por AES-256-GCM e as senhas via hash forte, o risco primário restringe-se a dados cadastrais nominais.

### B. Ataque DDoS ou Abuso de APIs

1. **Contenção:** Ajustar as regras do limitador de requisições no `buckets.ts` para limites mais agressivos (ex: reduzir `publicRead` para 30 req/min).
2. **Mitigação:** Ativar modo "I'm Under Attack" no WAF/Cloudflare se o tráfego ultrapassar a capacidade do Edge Runtime.

---

## 4. Contatos de Emergência (Comitê de Crise)

_(Preencher com os dados reais da operação antes do lançamento oficial)_

- **DPO (Encarregado de Dados):** [Nome] - [Telefone] - [E-mail]
- **Líder de Engenharia/Segurança:** [Nome] - [Telefone]
- **Assessoria Jurídica:** [Contato]

---

## 5. Template de Notificação à ANPD (Art. 48)

Em caso de incidente **P1**, este template deve ser preenchido e enviado à Autoridade Nacional de Proteção de Dados e aos titulares afetados.

**Assunto:** Notificação de Incidente de Segurança - Hezi Tech

**1. Natureza dos dados pessoais afetados:**
_(Ex: Dados cadastrais básicos como nome, e-mail e histórico de partidas. Informamos que senhas e documentos sensíveis encontravam-se sob forte criptografia e não foram expostos em texto plano)._

**2. Categoria e volume de titulares envolvidos:**
_(Ex: Aproximadamente X mil usuários cadastrados na liga, incluindo atletas e torcedores)._

**3. Indicação das medidas técnicas e de segurança utilizadas:**
_(Ex: O sistema utiliza algoritmos de hash de última geração para senhas e criptografia AES-256-GCM para dados sensíveis em repouso)._

**4. Riscos relacionados ao incidente:**
_(Ex: Possibilidade de campanhas de phishing direcionadas utilizando os e-mails vazados)._

**5. Motivos da demora (se a notificação não for imediata):**
_(Ex: O tempo foi estritamente necessário para conter a brecha e dimensionar com exatidão o volume de dados afetados, garantindo a precisão desta comunicação)._

**6. Medidas que foram ou que serão adotadas para reverter ou mitigar os efeitos:**
_(Ex: Invalidação em massa de todas as sessões de acesso, rotação de chaves de infraestrutura e implementação de novas regras de firewall)._

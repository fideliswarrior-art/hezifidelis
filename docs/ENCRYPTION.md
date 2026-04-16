# 🔐 Criptografia em Repouso (Data at Rest)

**Módulo:** `lib/security/crypto/encryption.ts`
**Algoritmo:** AES-256-GCM (Authenticated Encryption with Associated Data)
**Objetivo:** Proteger dados sensíveis no banco de dados contra vazamentos, garantindo conformidade com a LGPD (Art. 46) e o princípio de _Defense in Depth_.

---

## 1. Visão Geral

A Hezi Tech não armazena dados críticos em texto plano. Campos como o segredo de Autenticação de Dois Fatores (`twoFactorSecret`) e futuros documentos sensíveis (CPFs, etc.) são criptografados na camada de aplicação antes de serem persistidos no banco de dados (Prisma/PostgreSQL).

Utilizamos o modo **GCM (Galois/Counter Mode)** porque ele fornece não apenas confidencialidade (ninguém consegue ler sem a chave), mas também **integridade** (se alguém alterar um único caractere direto no banco de dados, a descriptografia falhará em vez de retornar lixo, disparando um alerta de segurança).

## 2. Formato do Dado Cifrado (Ciphertext)

Para permitir a rotação contínua de chaves sem quebrar os dados antigos, o nosso motor de criptografia salva os dados em um formato estrito, separado por dois pontos (`:`):

```text
keyId : ivBase64 : authTagBase64 : cipherBase64
```

- **`keyId`:** Identificador da chave que foi usada (ex: `k1`). Permite que o sistema saiba qual chave buscar no cofre.
- **`ivBase64`:** Vetor de Inicialização (12 bytes). Um valor aleatório gerado para _cada_ operação, garantindo que a mesma palavra criptografada duas vezes gere textos diferentes.
- **`authTagBase64`:** Tag de Autenticação (16 bytes). A "assinatura" do GCM que garante que os dados não foram adulterados.
- **`cipherBase64`:** O dado criptografado em si.

## 3. Gerenciamento de Chaves

As chaves são injetadas via variáveis de ambiente (`.env`). A chave de criptografia **NUNCA** deve ser commitada no repositório.

```env
DATA_ENCRYPTION_KEY="<chave-base64-de-32-bytes>"
DATA_ENCRYPTION_KEY_ID="k1"
```

- A chave deve ter exatamente 32 bytes (256 bits).
- Para gerar uma nova chave segura em sistemas Unix/Linux/Mac: `openssl rand -base64 32`
- Em desenvolvimento, se a chave não for fornecida, o sistema usa uma chave efêmera de memória para não bloquear o trabalho, mas **em produção o servidor se recusará a iniciar (Fail-Secure)**.

---

## 4. Runbook: Rotação de Chaves

A rotação de chaves é a prática de trocar a chave de criptografia atual por uma nova. Isso deve ser feito periodicamente ou em caso de suspeita de vazamento da variável de ambiente.

**Como executar uma rotação:**

1.  **Gere a nova chave:** `openssl rand -base64 32`.
2.  **Defina o novo ID:** Se a atual é `k1`, a nova será `k2`.
3.  **Atualize o código temporariamente:** No arquivo `key-management.ts`, atualize a função `getKeyById` para ser capaz de ler tanto a chave nova (do `process.env.DATA_ENCRYPTION_KEY`) quanto a antiga (que você pode passar para uma variável como `OLD_ENCRYPTION_KEY`).
4.  **Crie e rode um script de migração:** Um script que faça um `SELECT` em todos os registros com `k1`, descriptografe e criptografe novamente (agora ele usará `k2` automaticamente).
5.  **Limpeza:** Após confirmar que não há mais nenhum dado no banco começando com `k1:`, remova a chave antiga do sistema e do `key-management.ts`.

---

## 5. Recuperação de Desastres (Disaster Recovery)

🚨 **ATENÇÃO CRÍTICA:** Se a `DATA_ENCRYPTION_KEY` de produção for perdida, **TODOS os dados criptografados serão perdidos para sempre**. Não existe _backdoor_ matemático para o AES-256.

**Procedimento em caso de perda de chave:**

1.  Os usuários que dependem de campos cifrados (ex: 2FA) perderão o acesso.
2.  O administrador (via acesso direto ao banco ou painel sem 2FA) precisará resetar as contas afetadas (ex: forçar `twoFactorSecret = null` e `isTwoFactorEnabled = false`).
3.  Os usuários deverão reconfigurar seus métodos de segurança no próximo login.
4.  Uma nova chave deve ser configurada no `.env` imediatamente para que os novos registros voltem a ser protegidos.

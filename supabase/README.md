# Configuração do Supabase

## Criar o projeto

1. Crie um projeto no painel do Supabase.
2. Em **Project Settings > API**, obtenha a URL e a chave publicável do projeto.
3. Configure essas informações no arquivo local `.env`; não versione esse arquivo.

O Judineik AI não exige `SUPABASE_SERVICE_ROLE_KEY` em seu runtime.

## Aplicar as migrações

Com a CLI do Supabase vinculada ao seu projeto, execute:

```bash
supabase db push
```

As migrações devem ser aplicadas na ordem numérica:

1. `0001_initial_schema.sql`: documentos, resumos, questões, sessões, Storage e políticas iniciais.
2. `0002_allow_text_materials.sql`: permite materiais persistidos a partir de texto colado.
3. `0003_ai_generation_rate_limits.sql`: quota diária de IA e reservas concorrentes.
4. `0004_flashcards.sql`: conjuntos e cartões persistentes.
5. `0005_flashcard_spaced_repetition.sql`: agendamento e histórico de revisões.
6. `0006_multilingual_generated_content.sql`: conteúdo persistente separado por idioma.
7. `0007_document_topics.sql`: tópicos descobertos a partir de intervalos persistidos do material.
8. `0008_topic_generated_content.sql`: resumos por tópico e escopo de geração correspondente.
9. `0009_topic_questions.sql`: conjuntos, sessões e prática de questões por tópico.
10. `0010_topic_flashcards.sql`: conjuntos de flashcards por tópico.
11. `0011_ai_ip_rate_limits.sql`: proteção diária combinada por conta e por identificador de rede.

Não pule migrações e não altere a ordem em um projeto vazio.

As migrações também configuram geração multilíngue persistida, reservas de geração de IA com limite diário, conteúdo de tópicos e políticas RLS. O acesso do aplicativo é autenticado e isolado por usuário; as escritas sensíveis ocorrem pelas RPCs aprovadas, não por acesso direto do cliente às tabelas de geração.

## Configurar autenticação

1. Em **Authentication > Providers**, habilite Email.
2. Mantenha autenticação por senha habilitada.
3. Configure a confirmação de e-mail conforme o ambiente.
4. Preserve os links de recuperação gerados pelo Supabase Auth.

O Judineik AI usa Supabase Auth para cadastro, confirmação de e-mail, login, recuperação de senha, sessões e tokens.

## Configurar SMTP personalizado

Para produção, configure o SMTP diretamente em:

```text
Authentication > Emails > SMTP Settings
```

Campos necessários:

- Host
- Porta
- Usuário
- Senha
- E-mail do remetente
- Nome do remetente

Credenciais SMTP pertencem somente às configurações do Supabase. Nunca as adicione a variáveis `VITE_*`, ao frontend ou ao repositório.

## Configurar Storage

A migração inicial cria o bucket privado `documents`. Arquivos devem usar o ID do usuário autenticado como primeiro segmento do caminho:

```text
{user_id}/{file_name}
```

As políticas de Storage permitem acesso apenas quando esse segmento corresponde a `auth.uid()`.

## Configurar URLs de redirecionamento

Em **Authentication > URL Configuration**, configure a Site URL da aplicação e autorize as URLs usadas por cada ambiente.

Desenvolvimento local:

```text
http://localhost:8080/app
http://localhost:8080/auth/reset
```

Produção:

```text
https://seu-dominio/app
https://seu-dominio/auth/reset
```

A confirmação de e-mail usa `/app`; a recuperação de senha exige `/auth/reset` autorizado.

## Variáveis de ambiente

Cliente:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

Servidor:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
NVIDIA_API_KEY
OPENROUTER_API_KEY
OPENROUTER_MODEL
AI_IP_HMAC_SECRET
AI_QUOTA_RPC_SIGNING_SECRET
```

Use `OPENROUTER_MODEL=openai/gpt-oss-20b` nos ambientes server-side de Preview e Production. O
fallback continua configurável, mas o slug `openai/gpt-oss-20b:free` não deve ser usado para o
gateway de produção.

As chaves NVIDIA, OpenRouter e os segredos de quota são exclusivamente de servidor. Não use prefixo `VITE_` para elas.

Antes de aplicar `0011_ai_ip_rate_limits.sql`, crie no Supabase Vault um segredo chamado
`AI_QUOTA_RPC_SIGNING_SECRET`. O valor deve ser o mesmo configurado no ambiente server-side da
aplicação, ter pelo menos 32 bytes e nunca ser exposto ao cliente. `AI_IP_HMAC_SECRET` permanece
somente no ambiente server-side da aplicação e não deve ser armazenado no banco.

### Rollout da quota por conta e rede

`0011` remove as assinaturas antigas dos RPCs de reserva/finalização; por isso, app antigo e app
novo não são compatíveis com o mesmo banco durante a troca. Preview deve usar um projeto Supabase
separado para validar migration e app novos juntos. Em Production, use uma janela controlada:

1. bloqueie temporariamente novas gerações de IA na borda/aplicação;
2. aguarde requisições de geração em andamento terminarem;
3. confirme que `AI_QUOTA_RPC_SIGNING_SECRET` no Vercel corresponde ao segredo de mesmo nome no Vault;
4. aplique `0011`;
5. publique imediatamente o app novo e valide uma reserva sem chamar provider, quando possível;
6. reabra as gerações somente após o app novo estar saudável.

Não restaure os RPCs antigos para rollback, pois isso reabre o bypass da quota de rede. Se o app
novo precisar ser revertido, mantenha as gerações bloqueadas e reverta migration e app juntos em
uma janela controlada, usando um script de rollback previamente revisado.

Deployments que compartilham banco e tráfego de usuários precisam compartilhar o mesmo
`AI_IP_HMAC_SECRET`, para que a mesma rede produza o mesmo digest. O
`AI_QUOTA_RPC_SIGNING_SECRET` server-side deve sempre corresponder ao Vault do banco usado por esse
deployment. Não rotacione `AI_IP_HMAC_SECRET` durante um dia UTC: isso dividiria a contagem diária
entre dois digests. `key_version` permite uma rotação futura em uma fronteira UTC sem reescrever o
histórico; a migration atual aceita somente a versão `1`.

### Retenção da quota de rede

A reserva não executa limpeza. A função `cleanup_ai_ip_generation_events()` remove somente eventos
com mais de sete dias e nunca remove o dia UTC atual. Ela permanece indisponível para `PUBLIC`,
`anon` e `authenticated`.

Quando `pg_cron` não estiver disponível, a migration `0012` concede execução somente a `service_role`
para a rota interna `/api/ai-ip-retention`. Essa rota só aceita o Bearer token do Vercel Cron e exige
que `AI_RETENTION_CRON_SECRET` e `CRON_SECRET` sejam o mesmo segredo server-only. O job é declarado
em `vercel.json` para execução diária às `03:17 UTC`; no plano Hobby, a Vercel pode executá-lo em
qualquer momento daquela hora. A chamada é idempotente e não recebe parâmetros nem acesso direto a
tabelas de quota.

`operations/schedule_ai_ip_quota_retention.sql` continua disponível apenas para projetos com
`pg_cron`; não habilite os dois mecanismos no mesmo ambiente.

Para validar `0011` sem acessar Supabase remoto, execute `npm run test:postgres:ai-quota`. O comando
inicia um PostgreSQL 18 efêmero somente em loopback, aplica uma base Supabase mínima e a migration,
usa identidades/segredos sintéticos e remove o cluster ao terminar.

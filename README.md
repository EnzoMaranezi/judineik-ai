# NEXA

Plataforma de estudos com IA que transforma materiais acadêmicos em resumos, questões, flashcards e revisões espaçadas.

**Status: Beta - v0.1.0**

[Acessar a aplicação pública atual](https://nexaai-gamma.vercel.app)

O link acima aponta para o deployment público atual do NEXA. Forks e instalações locais devem configurar sua própria URL e infraestrutura.

## Sobre o NEXA

O NEXA organiza materiais acadêmicos em uma experiência de estudo contínua. Depois de enviar um PDF ou colar anotações, o estudante pode gerar conteúdo contextual, praticar com questões, revisar flashcards e acompanhar sua evolução sem perder o vínculo com o material original.

## Funcionalidades

- Autenticação, recuperação de senha e rotas protegidas com Supabase Auth.
- Upload de PDF e materiais persistentes a partir de notas coladas.
- Resumo, questões e flashcards para o material completo.
- Practice My Mistakes para praticar erros anteriores.
- Flashcards com revisão espaçada e histórico de revisões.
- Study by Topics: descoberta de tópicos e conteúdo independente por tópico.
- Resumo, questões, prática e flashcards por tópico.
- Overview, Progress e histórico de Study Sessions com dados reais.
- Interface e conteúdo gerado em português brasileiro e inglês.
- Feedback de progresso para gerações de IA de longa duração.

## Como funciona

```text
Material
  -> processamento
  -> estudo do material completo
       -> resumo
       -> questões
       -> flashcards
  -> estudo por tópicos
       -> resumo do tópico
       -> questões do tópico
       -> flashcards do tópico

Questões
  -> Study Sessions
  -> Practice My Mistakes

Flashcards
  -> revisão espaçada

Toda atividade de estudo
  -> Overview / Progress / Study Sessions
```

O processamento prepara o material e identifica sua estrutura; ele não gera perguntas. O material persistido é a fonte de verdade para o conteúdo gerado. Resumos, questões e flashcards existentes são reutilizados quando possível.

## Study by Topics

O NEXA descobre tópicos a partir do conteúdo persistido do material e mantém cada tópico vinculado aos seus intervalos de fonte. Cada tópico pode ter seu próprio resumo, questões, prática de erros e flashcards, sem se misturar ao conteúdo do material completo. Conteúdo já gerado e salvo é reutilizado pelo escopo e idioma, sem consumir uma nova geração de IA.

## Arquitetura

### Frontend

- React 19
- TypeScript
- Tailwind CSS
- TanStack Start
- Vite

### Backend e plataforma

- Supabase Auth
- PostgreSQL
- Supabase Storage privado
- Row Level Security (RLS)
- Server Functions do TanStack Start

### IA

- NVIDIA NIM `openai/gpt-oss-20b` como provedor principal.
- OpenRouter `openai/gpt-oss-20b` como fallback de baixo custo, configurado por `OPENROUTER_MODEL`.
- O gateway centralizado executa a seleção e o fallback apenas no servidor; o navegador não chama provedores diretamente.
- Chaves dos provedores permanecem somente no servidor.
- Uma única reserva de quota por ação do usuário, mesmo quando há tentativa de fallback.
- Prompts e parsers próprios para conteúdo acadêmico em Markdown.

O agendamento dos flashcards é determinístico e executado no servidor. Ele foi projetado para oferecer intervalos previsíveis no Beta, sem afirmar eficácia científica além do comportamento implementado.

### Quota e feedback de geração

Cada usuário pode executar até 20 gerações de IA por dia UTC. Uma proteção antiabuso adicional limita a rede de origem a 100 gerações agregadas por dia UTC, sem armazenar o IP puro. Conteúdo em cache ou já persistido não consome uma nova geração, e todas as tentativas de fallback fazem parte da mesma ação reservada.

Durante gerações longas, o NEXA mostra uma barra indeterminada com mensagens de status localizadas e rotativas. Não há porcentagem artificial: o resultado substitui o feedback somente quando a resposta real do servidor é concluída.

## Segurança

- Documentos são armazenados em bucket privado.
- Políticas RLS isolam documentos, conteúdo gerado e sessões por usuário.
- Chaves dos provedores de IA permanecem no servidor.
- Nenhuma chave `service_role` é usada pelo frontend ou exigida pela aplicação.
- Server Functions autenticadas validam identidade e propriedade dos documentos.
- Quotas e bloqueios transacionais protegem gerações concorrentes e uso excessivo.

## Internacionalização

O NEXA oferece interface em português brasileiro (`pt-BR`) e inglês (`en`). Resumos, conjuntos de questões e flashcards de materiais e tópicos são persistidos separadamente por idioma. Alterar o idioma não regenera conteúdo nem consome quota automaticamente.

## Rodando localmente

### Pré-requisitos

- Node.js compatível com o projeto
- npm
- Projeto Supabase configurado
- Credencial de pelo menos um provedor de IA compatível

### Instalação

```bash
npm install
```

Crie seu arquivo local de ambiente a partir de `.env.example` e preencha somente com as credenciais do seu próprio projeto:

```bash
cp .env.example .env
```

No Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Configure `OPENROUTER_MODEL=openai/gpt-oss-20b`. O sufixo `:free` não é usado pelo gateway de
produção porque esse endpoint não oferece disponibilidade suficiente para servir como fallback.

Execute as migrações em ordem:

1. `0001_initial_schema.sql`: documentos, conteúdo inicial, Storage e RLS.
2. `0002_allow_text_materials.sql`: materiais somente de texto colado.
3. `0003_ai_generation_rate_limits.sql`: quota diária e reservas de geração.
4. `0004_flashcards.sql`: conjuntos e cartões persistentes.
5. `0005_flashcard_spaced_repetition.sql`: agendamento e histórico de revisões.
6. `0006_multilingual_generated_content.sql`: conteúdo gerado separado por idioma.
7. `0007_document_topics.sql`: tópicos vinculados a intervalos da fonte.
8. `0008_topic_generated_content.sql`: resumos no escopo de tópicos.
9. `0009_topic_questions.sql`: questões e prática no escopo de tópicos.
10. `0010_topic_flashcards.sql`: flashcards no escopo de tópicos.
11. `0011_ai_ip_rate_limits.sql`: quota combinada por conta e proteção antiabuso por rede.

Consulte [`supabase/README.md`](supabase/README.md) para configurar Auth, Storage, SMTP e URLs de redirecionamento.

Inicie o ambiente local:

```bash
npm run dev
```

## Scripts

Scripts definidos em `package.json`:

- `npm run dev`: inicia o servidor de desenvolvimento.
- `npm run build`: cria o build de produção.
- `npm run build:dev`: cria um build em modo de desenvolvimento.
- `npm run preview`: executa o preview do build.
- `npm test`: executa toda a suíte de testes TypeScript atual.
- `npm run lint`: executa o ESLint.
- `npm run format`: formata o projeto com Prettier.

Execute toda a suíte de testes com:

```bash
npm test
```

## Estrutura do projeto

```text
src/                  aplicação React, rotas, serviços e funções de servidor
public/               arquivos públicos estáticos
scripts/              ferramentas locais de compatibilidade dos provedores
supabase/migrations/  esquema PostgreSQL, RLS, Storage e RPCs
supabase/README.md     configuração do projeto Supabase
```

## Limitações do Beta

- PDF é o único formato de arquivo aceito; texto pode ser adicionado por colagem.
- Conteúdo gerado por IA pode conter imprecisões e deve ser revisado pelo estudante.
- Disponibilidade e limites dos provedores externos podem afetar novas gerações.
- O produto está em validação ativa e alguns fluxos ainda podem evoluir.

## Roadmap

- Recomendações mais profundas no Overview.
- Análises ampliadas de revisão e retenção.
- Suporte a mais formatos de material.
- Melhorias contínuas de acessibilidade e experiência de estudo.

Não há datas prometidas para esses itens.

## Feedback

Relatos de bugs e sugestões são bem-vindos por meio das Issues deste repositório. Não inclua materiais privados, credenciais ou informações pessoais ao abrir uma issue.

## Licença

O código-fonte está publicamente visível para fins de demonstração e portfólio. Nenhuma licença de código aberto foi concedida neste momento. O uso, a cópia, a modificação ou a redistribuição dependem de autorização expressa do autor, salvo quando exigido por lei. Uma licença poderá ser adicionada explicitamente em uma versão futura.

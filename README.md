# Judineik AI

Plataforma de estudos com IA que transforma materiais acadêmicos em resumos, questões e flashcards, mantendo todo o conteúdo conectado ao material original.

[**Acessar aplicação**](https://nexaai-gamma.vercel.app/)

> Projeto desenvolvido como aplicação full-stack para explorar geração de conteúdo com IA, autenticação, persistência de dados, segurança, quotas de uso e experiência de estudo.

<p align="center">
  <img
    src="https://github.com/user-attachments/assets/0b04e12a-d33f-4de5-a1ec-5a1027c00f91"
    alt="Judineik AI - Dashboard"
    width="100%"
  />
</p>

## Sobre o projeto

O Judineik AI transforma materiais acadêmicos em uma experiência de estudo interativa.

O usuário pode enviar um PDF ou adicionar anotações, gerar um resumo do conteúdo, praticar com questões, revisar flashcards e acompanhar seu desempenho ao longo das sessões de estudo.

O projeto foi desenvolvido com foco não apenas na integração com modelos de IA, mas também na infraestrutura necessária para uma aplicação real: autenticação, armazenamento privado, isolamento de dados por usuário, controle de quota, persistência do conteúdo gerado e fallback entre provedores de IA.

## Principais funcionalidades

- Autenticação, recuperação de senha e rotas protegidas com Supabase Auth.
- Upload e processamento de documentos PDF.
- Criação de materiais a partir de texto.
- Geração de resumos contextualizados.
- Geração de questões de múltipla escolha.
- Practice My Mistakes para gerar novas questões com base nos erros anteriores.
- Flashcards com revisão espaçada e histórico de revisões.
- Overview, Progress e histórico de Study Sessions com dados reais.
- Renderização de Markdown e expressões matemáticas.
- Interface e conteúdo gerado em português brasileiro e inglês.
- Feedback visual durante gerações de IA de longa duração.
- Controle diário de uso de IA por usuário e proteção adicional contra abuso.

## Como funciona

```text
Material
   |
   +-- PDF
   |     |
   |     -> extração de texto
   |
   +-- Texto
         |
         -> conteúdo persistido
                |
                +--> Resumo
                |
                +--> Questões
                |
                +--> Flashcards
                         |
                         -> Revisão espaçada
```

O material processado é persistido e funciona como fonte para as gerações seguintes.

Resumos, questões e flashcards já existentes são reutilizados quando possível, evitando novas chamadas de IA desnecessárias.

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

### Fluxo simplificado

```text
Browser
   |
   v
React / TanStack Start
   |
   +------ Supabase Auth
   |
   +------ Server Functions
   |          |
   |          +------ PostgreSQL
   |          |
   |          +------ Supabase Storage
   |          |
   |          +------ AI Gateway
   |                     |
   |                     +-- NVIDIA NIM
   |                     |
   |                     +-- OpenRouter (fallback)
   |
   v
Interface do usuário
```

As chamadas aos provedores de IA são realizadas no servidor. Credenciais dos provedores não são expostas ao navegador.

## Geração com IA

O Judineik AI utiliza um gateway centralizado para geração de conteúdo acadêmico.

Atualmente:

- NVIDIA NIM com `openai/gpt-oss-20b` é o provedor principal.
- OpenRouter pode atuar como fallback, utilizando o modelo configurado em `OPENROUTER_MODEL`.
- A seleção e o fallback entre provedores acontecem somente no servidor.
- Chaves dos provedores permanecem exclusivamente no ambiente server-side.
- Uma única ação do usuário corresponde a uma única reserva de quota, mesmo quando ocorre fallback.
- Prompts e parsers específicos são utilizados para Summary, Questions e Flashcards.
- Markdown e expressões matemáticas são renderizados na interface.

O agendamento dos flashcards é determinístico e executado no servidor, oferecendo intervalos previsíveis de revisão.

## Quota e controle de uso

Cada usuário pode executar até 20 novas gerações de IA por dia UTC.

Existe também uma proteção antiabuso adicional que limita a rede de origem a 100 gerações agregadas por dia UTC, sem armazenar o endereço IP puro.

Conteúdo já persistido ou disponível em cache não consome uma nova geração.

Quando é necessário utilizar o provedor de fallback, as diferentes tentativas continuam pertencendo à mesma ação e à mesma reserva de quota.

Durante gerações mais longas, a interface apresenta feedback de processamento com mensagens localizadas. O resultado é exibido somente após a resposta real do servidor ser concluída.

## Segurança

A aplicação utiliza diferentes camadas para proteger dados e operações dos usuários:

- Documentos armazenados em bucket privado.
- Row Level Security para isolamento de dados entre usuários.
- Conteúdo gerado e sessões associados ao usuário autenticado.
- Server Functions autenticadas.
- Validação de propriedade dos documentos no servidor.
- Credenciais dos provedores de IA disponíveis somente no servidor.
- Nenhuma chave `service_role` é utilizada pelo frontend ou exigida pela aplicação.
- Controle transacional de quota para gerações concorrentes.
- Proteção adicional contra abuso de geração.

## Internacionalização

O Judineik AI possui suporte a:

- Português brasileiro (`pt-BR`)
- Inglês (`en`)

Resumos, conjuntos de questões e flashcards são persistidos separadamente por idioma.

Alterar o idioma da interface não dispara automaticamente uma nova geração nem consome quota.

## Executando localmente

### Pré-requisitos

- Node.js compatível com o projeto
- npm
- Projeto Supabase configurado
- Credencial de pelo menos um provedor de IA compatível

### Instalação

Clone o repositório:

```bash
git clone https://github.com/EnzoMaranezi/judineik-ai.git
cd judineik-ai
```

Instale as dependências:

```bash
npm install
```

Crie o arquivo de ambiente a partir de `.env.example`:

```bash
cp .env.example .env
```

No Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Preencha o arquivo somente com as credenciais da sua própria infraestrutura.

Para utilizar OpenRouter como fallback, configure:

```env
OPENROUTER_MODEL=openai/gpt-oss-20b
```

O sufixo `:free` não é utilizado pelo gateway de produção porque esse endpoint não oferece disponibilidade suficiente para funcionar como fallback confiável.

### Banco de dados

Execute as migrations do diretório:

```text
supabase/migrations/
```

na ordem numérica.

As migrations configuram, entre outros componentes:

- documentos e materiais;
- Storage;
- políticas RLS;
- quotas de geração;
- flashcards;
- histórico de revisões;
- conteúdo multilíngue;
- proteção antiabuso.

Algumas migrations históricas permanecem no projeto por fazerem parte da evolução do banco de dados, mesmo quando funcionalidades associadas não fazem mais parte da interface atual.

Consulte [`supabase/README.md`](./supabase/README.md) para detalhes sobre Auth, Storage, SMTP e URLs de redirecionamento.

### Desenvolvimento

Inicie o ambiente local:

```bash
npm run dev
```

## Scripts

Os principais scripts disponíveis em `package.json` são:

```bash
npm run dev
npm run build
npm run build:dev
npm run preview
npm test
npm run lint
npm run format
```

Para executar toda a suíte de testes:

```bash
npm test
```

## Estrutura do projeto

```text
src/
├── components/       componentes da interface
├── lib/              serviços, utilitários e lógica compartilhada
└── routes/           rotas e Server Functions

public/               arquivos públicos
scripts/              ferramentas auxiliares
supabase/
├── migrations/       schema, RLS, Storage e RPCs
└── README.md          documentação da infraestrutura Supabase
```

## Decisões técnicas

Algumas decisões importantes tomadas durante o desenvolvimento:

**Storage privado**

Os materiais enviados pelos usuários não são armazenados como arquivos públicos. O acesso é controlado por autenticação e políticas do Supabase.

**Row Level Security**

As políticas RLS impedem que um usuário consulte documentos, conteúdo gerado ou sessões pertencentes a outro usuário.

**IA somente no servidor**

O frontend não possui acesso direto às credenciais dos provedores de IA. As gerações passam pelas Server Functions.

**Fallback de provedores**

O gateway permite utilizar um provedor secundário quando o principal não consegue concluir a geração, sem criar uma segunda cobrança de quota para a mesma ação do usuário.

**Persistência do conteúdo gerado**

Resumos, questões e flashcards são armazenados no banco. Isso permite reutilizar resultados existentes e reduz chamadas desnecessárias aos modelos.

**Separação por idioma**

Conteúdo acadêmico gerado é persistido separadamente para português e inglês, evitando que uma simples troca do idioma da interface force uma nova geração.

## Limitações

- PDF é o único formato de arquivo aceito atualmente; materiais de texto também podem ser adicionados por colagem.
- Conteúdo produzido por modelos de IA pode conter imprecisões e deve ser revisado pelo estudante.
- Novas gerações dependem da disponibilidade dos provedores externos de IA.
- O projeto foi desenvolvido como aplicação de portfólio e demonstração técnica, não como serviço comercial.

## Feedback

Bugs e sugestões podem ser enviados por meio das Issues deste repositório.

Não inclua documentos privados, credenciais ou informações pessoais ao abrir uma issue.

## Autor

**Enzo Maranezi**

Bacharelado em Ciência da Computação — Universidade Federal de Alfenas (UNIFAL-MG)

[LinkedIn](https://www.linkedin.com/in/enzo-maranezi) · [GitHub](https://github.com/EnzoMaranezi)

## Licença

O código-fonte está publicamente visível para fins de demonstração e portfólio.

Nenhuma licença de código aberto foi concedida neste momento. O uso, cópia, modificação ou redistribuição depende de autorização expressa do autor, salvo quando exigido por lei.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { buildAiGenerationMessages } from "../src/lib/ai-generation-messages.ts";
import { parseTopicDiscoveryResponse } from "../src/lib/document-topics.parser.ts";
import {
  TOPIC_DISCOVERY_LANGUAGE_INSTRUCTION,
  TOPIC_DISCOVERY_OUTPUT_FORMAT,
  TOPIC_DISCOVERY_SYSTEM_PROMPT,
} from "../src/lib/document-topics.prompt.ts";
import { buildTopicSegmentMap, segmentDocumentSource } from "../src/lib/document-topics.source.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
for (const name of [".env.local", ".env"]) {
  const path = resolve(root, name);
  if (!process.env.NVIDIA_API_KEY && existsSync(path)) process.loadEnvFile(path);
}

if (!process.env.NVIDIA_API_KEY) throw new Error("NVIDIA_API_KEY is not configured.");

const model =
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ??
  "meta/llama-3.1-8b-instruct";
const endpoint = "https://integrate.api.nvidia.com/v1/chat/completions";
const fixtures = [
  {
    name: "heading-rich-academic-pt",
    title: "Fundamentos de Sistemas Operacionais",
    source: [
      "# Processos e estados\nUm processo é um programa em execução. Ele alterna entre os estados novo, pronto, executando, bloqueado e terminado. O bloco de controle armazena registradores, prioridade e informações de memória. ".repeat(4),
      "# Escalonamento da CPU\nO escalonador de curto prazo escolhe um processo da fila de prontos. FCFS respeita a ordem de chegada, enquanto Round Robin distribui fatias de tempo. O tempo de espera e o tempo de resposta ajudam a comparar políticas. ".repeat(4),
      "# Sincronização\nProcessos concorrentes podem disputar dados compartilhados. Mutexes implementam exclusão mútua e semáforos coordenam disponibilidade. Uma seção crítica deve impedir acessos simultâneos incorretos. ".repeat(4),
      "# Memória virtual\nPaginação separa endereços lógicos de quadros físicos. A tabela de páginas traduz endereços e uma falta de página ocorre quando o conteúdo necessário não está na memória principal. ".repeat(4),
    ].join("\n\n"),
  },
  {
    name: "normal-prose-no-headings-pt",
    title: "Ecologia de ecossistemas",
    source: `Ecossistemas reúnem comunidades biológicas e fatores físicos que trocam matéria e energia. Produtores convertem energia luminosa em matéria orgânica, enquanto consumidores obtêm energia pela alimentação e decompositores reciclam nutrientes. ${"O fluxo de energia diminui entre níveis tróficos porque parte da energia é dissipada como calor durante o metabolismo. ".repeat(4)} ${"Ciclos biogeoquímicos movimentam carbono, nitrogênio e água entre organismos, atmosfera, solo e ambientes aquáticos. ".repeat(4)} ${"Perturbações alteram a estrutura das comunidades, e a sucessão ecológica descreve mudanças graduais na composição das espécies. ".repeat(4)}`,
  },
  {
    name: "pasted-numbered-notes-pt",
    title: "Anotações sobre Bancos de Dados",
    source: [
      "modelo relacional organiza informações em tabelas; cada linha representa uma tupla e cada coluna representa um atributo",
      "chave primária identifica cada registro e não deve se repetir; chave estrangeira conecta registros de tabelas relacionadas",
      "normalização reduz redundância; primeira forma normal exige valores atômicos; segunda forma normal remove dependência parcial",
      "transação agrupa operações; atomicidade evita execução parcial; consistência preserva regras; isolamento separa operações concorrentes",
      "índices aceleram buscas mas ocupam espaço e aumentam o custo de escrita; o planejador escolhe estratégias de acesso",
      "join combina tabelas; inner join mantém correspondências; left join preserva todas as linhas da relação à esquerda",
    ].map((note, index) => `nota ${index + 1}: ${note}. ${note}.`).join("\n"),
  },
  {
    name: "pasted-bullet-notes-pt",
    title: "Anotações de Redes de Computadores",
    source: [
      "- Camada física transmite bits por meios guiados ou sem fio e define propriedades do sinal.",
      "- Camada de enlace organiza quadros, detecta erros locais e controla o acesso ao meio compartilhado.",
      "- Camada de rede encaminha pacotes entre redes e utiliza endereços IP para identificar interfaces.",
      "- Camada de transporte oferece comunicação fim a fim; TCP prioriza confiabilidade e UDP reduz sobrecarga.",
      "- DNS traduz nomes de domínio em endereços e utiliza uma hierarquia distribuída de servidores.",
      "- HTTP define mensagens de requisição e resposta usadas na comunicação entre clientes e servidores web.",
    ].map((note) => `${note} ${note.slice(2)} ${note.slice(2)}`).join("\n"),
  },
  {
    name: "mixed-headings-numbered-list-pt",
    title: "Estruturas de Dados",
    source: [
      "# Estruturas lineares\n1. Vetores armazenam elementos em posições contíguas e oferecem acesso por índice. 2. Listas encadeadas conectam nós por referências e facilitam inserções locais. ".repeat(4),
      "# Pilhas e filas\n3. Pilhas seguem a ordem LIFO, removendo primeiro o elemento mais recente. 4. Filas seguem a ordem FIFO, atendendo primeiro o elemento mais antigo. ".repeat(4),
      "# Árvores e busca\n5. Árvores binárias organizam cada nó com até dois filhos. 6. Árvores de busca mantêm uma relação de ordem que orienta pesquisas e inserções. ".repeat(4),
    ].join("\n\n"),
  },
  {
    name: "portuguese-academic-text-pt",
    title: "Fundamentos de Termodinâmica",
    source: [
      "A primeira lei da termodinâmica relaciona variação da energia interna, calor transferido e trabalho realizado. Em um sistema fechado, a energia atravessa a fronteira como calor ou trabalho, mas a massa permanece constante. ".repeat(4),
      "Processos isotérmicos mantêm temperatura constante, processos isobáricos mantêm pressão constante e processos isocóricos mantêm volume constante. Cada restrição altera a relação entre calor, trabalho e energia interna. ".repeat(4),
      "A segunda lei introduz entropia e determina a direção espontânea dos processos. Máquinas térmicas convertem parte do calor em trabalho, enquanto o restante deve ser rejeitado para um reservatório frio. ".repeat(4),
    ].join("\n\n"),
  },
  {
    name: "english-academic-text-en",
    title: "Foundations of Cell Biology",
    source: [
      "The plasma membrane is a selective barrier composed primarily of a phospholipid bilayer and embedded proteins. Passive transport follows concentration gradients, whereas active transport uses energy to move substances against a gradient. ".repeat(4),
      "Cellular respiration transfers chemical energy from nutrients into ATP. Glycolysis occurs in the cytosol, while the citric acid cycle and oxidative phosphorylation are associated with mitochondria in eukaryotic cells. ".repeat(4),
      "DNA replication copies genetic information before cell division. Transcription produces RNA from a DNA template, and translation uses messenger RNA to assemble a polypeptide at the ribosome. ".repeat(4),
    ].join("\n\n"),
  },
];

async function runFixture(fixture) {
  const segments = segmentDocumentSource(fixture.source);
  const messages = buildAiGenerationMessages({
    system: TOPIC_DISCOVERY_SYSTEM_PROMPT,
    prompt: `Document title: ${fixture.title}\n\nROWS:\n${buildTopicSegmentMap(segments)}`,
    outputFormat: TOPIC_DISCOVERY_OUTPUT_FORMAT,
    languageInstruction: TOPIC_DISCOVERY_LANGUAGE_INSTRUCTION,
    languageInstructionPlacement: "prompt-only",
    languageInstructionFormat: "instruction-only",
  });
  const startedAt = performance.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: messages.system },
        { role: "user", content: messages.prompt },
      ],
      temperature: 0.1,
      max_tokens: 1800,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const latencyMs = Math.round(performance.now() - startedAt);
  const bodyText = await response.text();
  if (!response.ok) {
    return {
      fixture: fixture.name,
      model,
      status: response.status,
      latencyMs,
      error: bodyText.slice(0, 300),
    };
  }
  const body = JSON.parse(bodyText);
  const output = body?.choices?.[0]?.message?.content;
  if (typeof output !== "string" || !output.trim()) throw new Error("NVIDIA returned no topic text.");
  let topics;
  try {
    topics = parseTopicDiscoveryResponse(output, fixture.source, segments);
  } catch (error) {
    return {
      fixture: fixture.name,
      model,
      status: response.status,
      latencyMs,
      segmentCount: segments.length,
      parserError: error instanceof Error ? error.message : String(error),
      rawOutput: output,
    };
  }
  const rateHeaders = Object.fromEntries(
    [...response.headers.entries()].filter(([name]) => /rate|limit|remaining|reset/i.test(name)),
  );
  return {
    fixture: fixture.name,
    model,
    status: response.status,
    latencyMs,
    segmentCount: segments.length,
    topicCount: topics.length,
    titles: topics.map((topic) => topic.title),
    validRanges: topics.every((topic) => topic.sourceRanges.length > 0),
    completeCoverage: topics.reduce((count, topic) => count + topic.sourceRanges.length, 0) > 0,
    outputLength: output.length,
    rateHeaders,
  };
}

const results = [];
const fixtureName = process.argv.find((argument) => argument.startsWith("--fixture="))?.slice("--fixture=".length);
const selectedFixtures = fixtureName
  ? fixtures.filter((fixture) => fixture.name === fixtureName)
  : process.argv.includes("--pasted-only")
  ? fixtures.filter((fixture) => fixture.name === "pasted-numbered-notes-pt")
  : process.argv.includes("--structured-only")
    ? fixtures.slice(0, 1)
    : fixtures;
if (selectedFixtures.length === 0) throw new Error(`Unknown fixture: ${fixtureName}`);
const iterations = Number(process.argv.find((argument) => argument.startsWith("--iterations="))?.slice("--iterations=".length) ?? "1");
for (const fixture of selectedFixtures) {
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    results.push({ iteration, ...(await runFixture(fixture)) });
  }
}
console.log(JSON.stringify({ model, results }, null, 2));

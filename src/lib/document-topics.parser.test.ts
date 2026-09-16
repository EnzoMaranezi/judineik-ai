import assert from "node:assert/strict";
import test from "node:test";
import { parseTopicDiscoveryResponse } from "./document-topics.parser.ts";
import { segmentDocumentSource, topicSegmentToken } from "./document-topics.source.ts";

const source = [
  "# Processos\n" + "Processos mantêm estado, contexto e recursos durante a execução. ".repeat(16),
  "# Escalonamento\n" +
    "Escalonamento escolhe tarefas prontas e distribui tempo de CPU. ".repeat(16),
  "# Sincronização\n" +
    "Mutexes e semáforos protegem recursos compartilhados entre tarefas. ".repeat(16),
].join("\n\n");
const segments = segmentDocumentSource(source);

function firstToken(tokens: string[]) {
  const token = tokens[0];
  assert.ok(token);
  return token;
}

function validOutput() {
  const groups: [string[], string[], string[]] = [[], [], []];
  segments.forEach((segment, index) =>
    groups[Math.min(2, Math.floor((index * 3) / segments.length))]?.push(
      topicSegmentToken(segment.id),
    ),
  );
  return JSON.stringify({
    topics: [
      {
        title: "Processos",
        description: "Estados, contextos e recursos associados à execução de processos.",
        segmentIds: groups[0],
        coreSegmentIds: [firstToken(groups[0])],
      },
      {
        title: "Escalonamento de CPU",
        description: "Seleção de tarefas prontas e distribuição do tempo de processamento.",
        segmentIds: groups[1],
        coreSegmentIds: [firstToken(groups[1])],
      },
      {
        title: "Sincronização concorrente",
        description: "Coordenação do acesso a recursos compartilhados com mutexes e semáforos.",
        segmentIds: groups[2],
        coreSegmentIds: [firstToken(groups[2])],
      },
    ],
  });
}

test("parses 3-12 grounded topics and returns ordered exact ranges", () => {
  const topics = parseTopicDiscoveryResponse(validOutput(), source, segments);
  assert.equal(topics.length, 3);
  assert.deepEqual(
    topics.map((topic) => topic.position),
    [1, 2, 3],
  );
  assert.ok(topics.every((topic) => topic.sourceRanges.length > 0));
});

test("accepts a JSON Markdown fence but rejects malformed output", () => {
  assert.equal(
    parseTopicDiscoveryResponse(`\`\`\`json\n${validOutput()}\n\`\`\``, source, segments).length,
    3,
  );
  assert.throws(
    () => parseTopicDiscoveryResponse("not json", source, segments),
    /MALFORMED_TOPIC_OUTPUT/u,
  );
});

test("rejects unknown segment IDs", () => {
  const parsed = JSON.parse(validOutput());
  parsed.topics[0].segmentIds[0] = "SEG:S999";
  parsed.topics[0].coreSegmentIds[0] = "SEG:S999";
  assert.throws(
    () => parseTopicDiscoveryResponse(JSON.stringify(parsed), source, segments),
    /UNKNOWN_TOPIC_SEGMENT/u,
  );
  parsed.topics[0].segmentIds[0] = "S001";
  parsed.topics[0].coreSegmentIds[0] = "S001";
  assert.throws(
    () => parseTopicDiscoveryResponse(JSON.stringify(parsed), source, segments),
    /INVALID_TOPIC_OUTPUT/u,
  );
});

test("rejects duplicate and near-duplicate topic titles", () => {
  const parsed = JSON.parse(validOutput());
  parsed.topics[1].title = "Processos!";
  assert.throws(
    () => parseTopicDiscoveryResponse(JSON.stringify(parsed), source, segments),
    /DUPLICATE_TOPIC_TITLE/u,
  );
});

test("rejects overlap across topics and insufficient coverage", () => {
  const duplicate = JSON.parse(validOutput());
  duplicate.topics[0].segmentIds.push(duplicate.topics[0].segmentIds[0]);
  assert.throws(
    () => parseTopicDiscoveryResponse(JSON.stringify(duplicate), source, segments),
    /DUPLICATE_TOPIC_SEGMENT/u,
  );

  const overlap = JSON.parse(validOutput());
  overlap.topics[1].segmentIds.push(overlap.topics[0].segmentIds[0]);
  assert.throws(
    () => parseTopicDiscoveryResponse(JSON.stringify(overlap), source, segments),
    /OVERLAPPING_DOCUMENT_TOPICS/u,
  );

  const missing = JSON.parse(validOutput());
  const groupWithMoreThanOneSegment = missing.topics.find(
    (topic: { segmentIds: string[] }) => topic.segmentIds.length > 1,
  );
  assert.ok(groupWithMoreThanOneSegment);
  groupWithMoreThanOneSegment.segmentIds.pop();
  assert.throws(
    () => parseTopicDiscoveryResponse(JSON.stringify(missing), source, segments),
    /INSUFFICIENT_TOPIC_COVERAGE/u,
  );
});

test("requires each topic to identify instructional core segments from its own assignment", () => {
  const missingCore = JSON.parse(validOutput());
  missingCore.topics[2].coreSegmentIds = [];
  assert.throws(
    () => parseTopicDiscoveryResponse(JSON.stringify(missingCore), source, segments),
    /INVALID_TOPIC_OUTPUT/u,
  );

  const foreignCore = JSON.parse(validOutput());
  foreignCore.topics[2].coreSegmentIds = [foreignCore.topics[0].segmentIds[0]];
  assert.throws(
    () => parseTopicDiscoveryResponse(JSON.stringify(foreignCore), source, segments),
    /INVALID_TOPIC_CORE_SEGMENT/u,
  );
});

test("keeps bibliography segments attached without letting them form a standalone topic", () => {
  const bibliographySource = [
    "Resultados de um dado representam uma variável aleatória discreta. Cada face possui uma probabilidade associada, e a distribuição descreve os resultados possíveis. ".repeat(
      5,
    ),
    "A função inversa permite relacionar valores de entrada e saída quando a correspondência pode ser desfeita. O material usa essa ideia para explicar o método da transformada inversa. ".repeat(
      5,
    ),
    "O método parte de uma variável uniforme e usa a inversa da função acumulada para obter resultados da distribuição estudada. A aplicação apresentada considera a distribuição exponencial. ".repeat(
      5,
    ),
    "Referências bibliográficas: obra publicada por John Wiley & Sons, edição de 2001. Material externo e informações de publicação para consulta complementar. ".repeat(
      3,
    ),
  ].join("\n\n");
  const bibliographySegments = segmentDocumentSource(bibliographySource);
  const bibliographyToken = topicSegmentToken(bibliographySegments.at(-1)!.id);
  const groups: [string[], string[], string[]] = [[], [], []];
  bibliographySegments.forEach((segment, index) => {
    groups[Math.min(2, Math.floor((index * 3) / bibliographySegments.length))]?.push(
      topicSegmentToken(segment.id),
    );
  });
  const output = JSON.stringify({
    topics: [
      {
        title: "Resultados e probabilidade de um dado",
        description:
          "Resultados possíveis e probabilidades associados à variável aleatória discreta.",
        segmentIds: groups[0],
        coreSegmentIds: [firstToken(groups[0])],
      },
      {
        title: "Funções inversas",
        description: "Papel da inversão de funções na construção apresentada pelo material.",
        segmentIds: groups[1],
        coreSegmentIds: [firstToken(groups[1])],
      },
      {
        title: "Método da transformada inversa",
        description: "Uso da função acumulada inversa e aplicação à distribuição exponencial.",
        segmentIds: groups[2],
        coreSegmentIds: [firstToken(groups[2].filter((token) => token !== bibliographyToken))],
      },
    ],
  });

  const topics = parseTopicDiscoveryResponse(output, bibliographySource, bibliographySegments);
  assert.equal(topics.length, 3);
  assert.doesNotMatch(topics.map((topic) => topic.title).join(" "), /Wiley|editora|2001/iu);
  assert.equal(
    JSON.parse(output).topics.flatMap((topic: { segmentIds: string[] }) => topic.segmentIds).length,
    bibliographySegments.length,
  );
});

test("rejects ranges outside the persisted source and topics with too little grounding", () => {
  const invalidSegments = segments.map((segment, index) =>
    index === 0 ? { ...segment, end: Array.from(source).length + 1 } : segment,
  );
  assert.throws(
    () => parseTopicDiscoveryResponse(validOutput(), source, invalidSegments),
    /INVALID_TOPIC_SOURCE_RANGE/u,
  );

  const tinySource = "um dois três quatro cinco seis sete oito nove dez";
  const tinySegments = [
    { id: "S001", start: 0, end: 10, text: "um dois" },
    { id: "S002", start: 10, end: 25, text: "três quatro" },
    { id: "S003", start: 25, end: Array.from(tinySource).length, text: "cinco seis" },
  ];
  const tinyOutput = JSON.stringify({
    topics: [
      {
        title: "Tema um",
        description: "Uma descrição acadêmica suficientemente longa.",
        segmentIds: ["SEG:S001"],
        coreSegmentIds: ["SEG:S001"],
      },
      {
        title: "Tema dois",
        description: "Outra descrição acadêmica suficientemente longa.",
        segmentIds: ["SEG:S002"],
        coreSegmentIds: ["SEG:S002"],
      },
      {
        title: "Tema três",
        description: "Terceira descrição acadêmica suficientemente longa.",
        segmentIds: ["SEG:S003"],
        coreSegmentIds: ["SEG:S003"],
      },
    ],
  });
  assert.throws(
    () => parseTopicDiscoveryResponse(tinyOutput, tinySource, tinySegments),
    /TOPIC_SOURCE_TOO_SHORT/u,
  );
});

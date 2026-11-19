/*
 * Pruebas comparativas: envía cada caso de benchmark/cases.json a POST /api/analyze
 * con ambos modos y compara contra la clasificación de referencia.
 *
 * Uso:
 *   npm run benchmark                       (levanta la API en un puerto libre)
 *   BENCHMARK_URL=http://localhost:3000 npm run benchmark   (usa un servidor ya iniciado)
 *
 * Genera evidence/benchmark-results.json y evidence/RESULTADOS.md
 */
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { AnalysisResultSchema } from '../src/contract.js';
import { loadConfig } from '../src/config.js';
import { createRuntime } from '../src/runtime.js';

const MODES = ['traditional', 'ml', 'generative'];
const EVIDENCE_DIR = new URL('../evidence/', import.meta.url);
const cases = JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8'));

let baseUrl = process.env.BENCHMARK_URL?.replace(/\/+$/, '');
let server;
if (!baseUrl) {
  const config = { ...loadConfig(), rateLimitPerMinute: 10_000 };
  const quietLogger = { info() {}, warn: console.warn, error: console.error };
  const { app } = createRuntime(config, { logger: quietLogger });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function analyze(message, mode) {
  const started = performance.now();
  const res = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, mode }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, latencyMs: Math.round(performance.now() - started) };
}

const health = await (await fetch(`${baseUrl}/api/health`)).json();
const generative = health.engines.generative;
const ml = health.engines.ml;
if (!generative.available || !ml?.available) {
  console.error(`Motor no disponible -> generativo: ${generative.reason ?? 'ok'} | ml: ${ml?.reason ?? 'ok'}`);
  console.error('No se ejecuta el benchmark para no registrar resultados incompletos.');
  server?.close();
  process.exit(1);
}

console.log(`API: ${baseUrl} | Modelo generativo: ${generative.provider} / ${generative.model}`);
console.log('Calentando el modelo (la primera carga en GPU no se cuenta en la latencia)...');
await analyze('Prueba de calentamiento: no puedo ver mi perfil.', 'generative');

const results = [];
for (const testCase of cases) {
  const row = { id: testCase.id, type: testCase.type, message: testCase.message, expected: testCase.expected };
  for (const mode of MODES) {
    const { status, body, latencyMs } = await analyze(testCase.message, mode);
    const formatOk = status === 200 && AnalysisResultSchema.safeParse(body).success && body.mode === mode;
    const categoryOk = formatOk && body.category === testCase.expected.category;
    const priorityOk = formatOk && body.priority === testCase.expected.priority;
    row[mode] = {
      status,
      latencyMs,
      formatOk,
      categoryOk,
      priorityOk,
      correct: categoryOk && priorityOk,
      reviewOk: formatOk && (!testCase.expected.requiresHumanReview || body.requiresHumanReview === true),
      output: body,
    };
    const mark = row[mode].correct ? 'OK ' : 'MAL';
    console.log(
      `#${String(testCase.id).padStart(2)} ${mode.padEnd(11)} ${mark} ${status} ` +
        `${body?.category ?? body?.error?.code ?? '-'} / ${body?.priority ?? '-'} (${latencyMs} ms)`,
    );
  }
  results.push(row);
}
server?.close();

const pct = (n, total) => Math.round((n / total) * 1000) / 10;
const securityCases = results.filter((r) => r.expected.requiresHumanReview);
const summary = Object.fromEntries(
  MODES.map((mode) => {
    const rows = results.map((r) => r[mode]);
    const count = (key) => rows.filter((r) => r[key]).length;
    const avgLatency = Math.round(rows.reduce((acc, r) => acc + r.latencyMs, 0) / rows.length);
    return [
      mode,
      {
        total: rows.length,
        correct: count('correct'),
        accuracyPct: pct(count('correct'), rows.length),
        categoryAccuracyPct: pct(count('categoryOk'), rows.length),
        priorityAccuracyPct: pct(count('priorityOk'), rows.length),
        formatOkPct: pct(count('formatOk'), rows.length),
        humanReviewFlaggedPct: pct(securityCases.filter((r) => r[mode].reviewOk).length, securityCases.length),
        avgLatencyMs: avgLatency,
      },
    ];
  }),
);

const meta = {
  generatedAt: new Date().toISOString(),
  provider: generative.provider,
  model: generative.model,
  mlModel: `${ml.algorithm} · ${ml.datasetRows} ejemplos · scikit-learn ${ml.sklearnVersion}`,
  node: process.version,
  platform: `${os.type()} ${os.release()}`,
  criteria: 'Correcto = categoría y prioridad coinciden con la referencia definida en benchmark/cases.json',
};

await mkdir(EVIDENCE_DIR, { recursive: true });
await writeFile(
  new URL('benchmark-results.json', EVIDENCE_DIR),
  `${JSON.stringify({ meta, summary, results }, null, 2)}\n`,
);
await writeFile(new URL('RESULTADOS.md', EVIDENCE_DIR), renderMarkdown(meta, summary, results));

console.log('\nResumen:');
console.table(
  Object.fromEntries(
    MODES.map((m) => [
      m,
      {
        correctas: `${summary[m].correct}/${summary[m].total}`,
        '% correctas': summary[m].accuracyPct,
        '% categoría': summary[m].categoryAccuracyPct,
        '% prioridad': summary[m].priorityAccuracyPct,
        '% formato OK': summary[m].formatOkPct,
        'latencia prom. (ms)': summary[m].avgLatencyMs,
      },
    ]),
  ),
);
console.log('Evidencia escrita en evidence/benchmark-results.json y evidence/RESULTADOS.md');

function renderMarkdown(metaInfo, summaryData, rows) {
  const yes = (v) => (v ? '✅' : '❌');
  const cell = (r) => (r.formatOk ? `${r.output.category} / ${r.output.priority}` : `HTTP ${r.status}`);
  const escape = (text) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lines = [
    '# Resultados de las pruebas comparativas',
    '',
    `- Fecha de ejecución: ${metaInfo.generatedAt}`,
    `- Motor generativo: ${metaInfo.provider} / \`${metaInfo.model}\``,
    `- Motor ML: ${metaInfo.mlModel}`,
    `- Node.js ${metaInfo.node} — ${metaInfo.platform}`,
    `- Criterio: ${metaInfo.criteria}`,
    '',
    '## Resumen',
    '',
    '| Motor | Correctas | % correctas | % categoría | % prioridad | % formato OK | Seguridad marcada p/ revisión | Latencia prom. |',
    '|---|---|---|---|---|---|---|---|',
    ...MODES.map((m) => {
      const s = summaryData[m];
      return `| ${m} | ${s.correct}/${s.total} | **${s.accuracyPct}%** | ${s.categoryAccuracyPct}% | ${s.priorityAccuracyPct}% | ${s.formatOkPct}% | ${s.humanReviewFlaggedPct}% | ${s.avgLatencyMs} ms |`;
    }),
    '',
    '## Detalle por caso',
    '',
    `| # | Tipo | Solicitud | Referencia | ${MODES.map((m) => `${m} | Formato | Correcto`).join(' | ')} |`,
    `|---|---|---|---|${MODES.map(() => '---|---|---').join('|')}|`,
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.type} | ${escape(r.message)} | ${r.expected.category} / ${r.expected.priority} | ` +
        `${MODES.map((m) => `${cell(r[m])} | ${yes(r[m].formatOk)} | ${yes(r[m].correct)}`).join(' | ')} |`,
    ),
    '',
    '## Respuestas generadas por el motor generativo',
    '',
    ...rows.map(
      (r) =>
        `${r.id}. ${r.generative.formatOk ? escape(r.generative.output.response) : `Error: ${r.generative.output?.error?.code ?? r.generative.status}`}` +
        ` _(revisión humana: ${r.generative.output?.requiresHumanReview ?? '-'})_`,
    ),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

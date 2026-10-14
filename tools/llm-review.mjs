#!/usr/bin/env node
/**
 * llm-review.mjs — ask a local LM Studio model (default: Gemma) to review project files.
 *
 * Usage:
 *   node tools/llm-review.mjs [files-or-dirs...] [options]
 *
 * Options:
 *   --instruction <text>   Extra instruction appended to the review prompt
 *   --model <name>         Model id (default: $LMSTUDIO_MODEL or google/gemma-4-12b)
 *   --base-url <url>       LM Studio base URL (default: $LMSTUDIO_BASE_URL or http://localhost:1234)
 *   --max-tokens <n>       Completion budget per request (default: 4000)
 *   --budget <chars>       Max source chars per request (default: 24000)
 *   -h, --help             Show help
 *
 * Defaults to reviewing docs/SPEC.md plus src/ when no paths are given.
 * Requires LM Studio with a server running (http://localhost:1234 by default).
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

const SYSTEM_PROMPT = [
  'You are a senior staff engineer performing a rigorous code/spec review.',
  'The project must pass Snyk (dependencies, injection, unsafe patterns) and SonarQube',
  '(complexity, coverage, maintainability) gates.',
  '',
  'Return ONLY a prioritized findings list:',
  '- Severity labels: BLOCKER, MAJOR, MINOR.',
  '- Each finding: file (and line if known) → what is wrong → concrete fix.',
  '- No praise, no summary preamble, no restating the code.',
  '- Max ~500 words per response.',
].join('\n');

const EXTENSIONS = new Set(['.ts', '.mts', '.mjs', '.md']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', 'data']);

const USAGE = `Usage: node tools/llm-review.mjs [files-or-dirs...] [options]

Reviews files (or all source files under given directories) with a local
LM Studio model. Run 'lmstudio' and start a server first.

Options:
  --instruction <text>   Extra instruction appended to the prompt
  --model <name>         Model id (default: $LMSTUDIO_MODEL or google/gemma-4-12b)
  --base-url <url>       LM Studio base URL (default: $LMSTUDIO_BASE_URL or http://localhost:1234)
  --max-tokens <n>       Completion budget per request (default: 4000)
  --budget <chars>       Max source chars per request (default: 24000)
  -h, --help             Show this help`;

function parseCli() {
  const { values, positionals } = parseArgs({
    options: {
      instruction: { type: 'string' },
      model: { type: 'string' },
      'base-url': { type: 'string' },
      'max-tokens': { type: 'string' },
      budget: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });
  return { values, positionals };
}

function positiveInt(raw, fallback) {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`expected a positive integer, got: ${raw}`);
  return n;
}

async function expandPaths(paths) {
  const files = [];
  for (const p of paths) {
    const stats = await statSafe(p);
    if (!stats) continue;
    if (stats.isFile()) {
      files.push(p);
    } else if (stats.isDirectory()) {
      files.push(...(await walk(p)));
    }
  }
  return files.sort();
}

async function statSafe(p) {
  try {
    return await stat(p);
  } catch {
    console.error(`llm-review: skipping missing path: ${p}`);
    return null;
  }
}

async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

async function buildChunks(files, budget) {
  const chunks = [];
  let current = '';
  for (const file of files) {
    let content;
    try {
      content = await readFile(file, 'utf8');
    } catch (err) {
      console.error(`llm-review: cannot read ${file}: ${err.message}`);
      continue;
    }
    if (content.length > budget)
      content = `${content.slice(0, budget)}\n...[truncated at ${budget} chars]`;
    const block = `=== ${file} ===\n${content}\n`;
    if (current.length > 0 && current.length + block.length > budget) {
      chunks.push(current);
      current = '';
    }
    current += block;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function extractContent(data) {
  const message = data?.choices?.[0]?.message;
  if (typeof message?.content === 'string' && message.content.length > 0) return message.content;
  return null;
}

async function requestCompletion(settings, system, user, maxTokens) {
  const res = await fetch(`${settings.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(settings.timeoutMs),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`LM Studio returned HTTP ${res.status}: ${body}`);
  }
  return res.json();
}

async function reviewChunk(settings, chunk, instruction) {
  const user = [
    'Review the following project files:',
    '',
    chunk,
    instruction ? `\nAdditional instruction: ${instruction}` : '',
  ].join('\n');

  let data = await requestCompletion(settings, SYSTEM_PROMPT, user, settings.maxTokens);
  let content = extractContent(data);

  // Reasoning models (e.g. gemma-4) spend the token budget on
  // `reasoning_content` before emitting the visible answer. If that happened,
  // retry once with a much larger budget so the answer actually lands.
  if (content === null) {
    const reasoning = data?.choices?.[0]?.message?.reasoning_content;
    if (typeof reasoning === 'string' && reasoning.length > 0) {
      const expanded = Math.min(settings.maxTokens * 4, 16_000);
      console.error(
        `llm-review: empty content after reasoning (${settings.maxTokens} tokens); retrying with ${expanded}`,
      );
      data = await requestCompletion(settings, SYSTEM_PROMPT, user, expanded);
      content = extractContent(data);
    }
  }

  const usage = data?.usage;
  if (usage) {
    console.error(
      `llm-review: tokens prompt=${usage.prompt_tokens ?? '?'} completion=${usage.completion_tokens ?? '?'}`,
    );
  }
  if (content !== null) return content;

  const reasoning = data?.choices?.[0]?.message?.reasoning_content;
  if (typeof reasoning === 'string' && reasoning.length > 0) {
    throw new Error(
      `model produced only reasoning, no answer (reasoning started: ${JSON.stringify(reasoning.slice(0, 200))}). ` +
        'Raise --max-tokens or use a non-reasoning model via --model.',
    );
  }
  throw new Error(
    `LM Studio returned no completion content: ${JSON.stringify(data).slice(0, 300)}`,
  );
}

async function main() {
  const { values, positionals } = parseCli();
  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  const settings = {
    baseUrl: (
      values['base-url'] ??
      process.env.LMSTUDIO_BASE_URL ??
      'http://localhost:1234'
    ).replace(/\/+$/, ''),
    model: values.model ?? process.env.LMSTUDIO_MODEL ?? 'google/gemma-4-12b',
    maxTokens: positiveInt(values['max-tokens'], 4000),
    budget: positiveInt(values.budget, 24_000),
    timeoutMs: positiveInt(process.env.LLM_REVIEW_TIMEOUT_MS, 600_000),
  };

  const targets = positionals.length > 0 ? positionals : ['docs/SPEC.md', 'src'];
  const files = await expandPaths(targets);
  if (files.length === 0) {
    console.error('llm-review: no reviewable files found.');
    return 1;
  }

  try {
    const probe = await fetch(`${settings.baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
  } catch (err) {
    console.error(`llm-review: cannot reach LM Studio at ${settings.baseUrl} (${err.message}).`);
    console.error('Start LM Studio, enable the local server, then retry.');
    return 1;
  }

  const chunks = await buildChunks(files, settings.budget);
  console.error(
    `llm-review: ${files.length} file(s), ${chunks.length} request(s), model=${settings.model}`,
  );

  for (const [i, chunk] of chunks.entries()) {
    console.error(`llm-review: request ${i + 1}/${chunks.length}...`);
    const verdict = await reviewChunk(settings, chunk, values.instruction ?? '');
    console.log(`\n--- review batch ${i + 1}/${chunks.length} ---\n`);
    console.log(verdict);
  }
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`llm-review: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  },
);

/**
 * The workflow documents, parsed.
 *
 * The workflows are read with the `yaml` package — the same parser the
 * OpenAPI contract suite uses — so the checks read the DOCUMENT's
 * structure: a job's steps, a step's `uses`, a step's `run`, a step's
 * `with`. A text guard has to re-implement YAML's rules to find the same
 * facts, and every rule it re-implements is a rule it can get wrong.
 * The guard that used to do exactly that grew to nearly eight hundred
 * lines, and most of what was left was tests of that parser rather than
 * of the workflow it guarded.
 *
 * This module is the parser, and nothing else: it holds no checks, so
 * the two guard files that read the workflows — `ci-workflow.test.ts`
 * for the merge gate and `ci-scanner-jobs.test.ts` for the scanning jobs
 * — share one reading of the documents rather than two.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const WORKFLOWS_DIR = fileURLToPath(new URL('../.github/workflows/', import.meta.url));

/** One step of a job, as the document declares it. */
export interface Step {
  /** The step's name, or its action, or its position — for a failure message. */
  readonly label: string;
  /** The action the step runs, when it runs one. */
  readonly uses: string | undefined;
  /** The command the step runs, when it runs one. */
  readonly run: string | undefined;
  /** The step's inputs. */
  readonly with: Record<string, unknown>;
}

/** One job, as the document declares it. */
export interface Job {
  /** The mapping key the job is written under. */
  readonly key: string;
  /** The job's display name — the name a check reports under. */
  readonly name: string;
  readonly steps: readonly Step[];
  /** The job's matrix, when it has one. */
  readonly matrix: Record<string, unknown> | undefined;
  /** The container image the job runs in, when it names one. */
  readonly image: string | undefined;
  /** The runner label the job runs on — a label, or a list of them. */
  readonly runsOn: string | undefined;
  /**
   * The job's condition, as the document writes it.
   *
   * A job-level `if:` decides whether the job runs at all, so it decides
   * whether the steps inside it run — an `if: false` switches a whole
   * scan off while every check still reports green.
   */
  readonly if: string | undefined;
}

/** One workflow file, parsed. */
export interface Workflow {
  readonly file: string;
  /** The raw text — for the few checks that read a COMMENT. */
  readonly text: string;
  readonly jobs: readonly Job[];
}

interface RawStep {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
}

interface RawJob {
  readonly name?: string;
  readonly steps?: readonly RawStep[];
  readonly strategy?: { readonly matrix?: Record<string, unknown> };
  readonly container?: string | { readonly image?: string };
  readonly 'runs-on'?: string | readonly string[];
  readonly if?: string;
}

/**
 * The image a job's `container:` names — a bare string, or a mapping
 * with an `image:` key. Undefined when the job names no container.
 *
 * The container is a JOB-level key: GitHub's workflow schema has no
 * step-level `container`, so a step cannot name an image of its own.
 */
function containerImage(container: RawJob['container']): string | undefined {
  if (typeof container === 'string') return container;
  return container?.image;
}

/**
 * The runner a job runs on, as text: a label, or the labels of a list.
 *
 * `runs-on` takes either a single label or a list of them, and a label
 * that says `arm` says the job runs on an arm64 runner — which is what
 * the semgrep job must not do.
 */
function runnerLabel(runsOn: RawJob['runs-on']): string | undefined {
  if (runsOn === undefined) return undefined;
  return typeof runsOn === 'string' ? runsOn : runsOn.join(' ');
}

/** Parse one workflow file into its jobs and steps. */
export function loadWorkflow(file: string): Workflow {
  return parseWorkflow(readFileSync(join(WORKFLOWS_DIR, file), 'utf8'), file);
}

/**
 * Parse the TEXT of a workflow into its jobs and steps.
 *
 * The file-reading wrapper above is the common case; a guard that needs to
 * read a workflow that is not on disk — a literal it writes out to pin one
 * reading of the document — parses its text here, so it reads the document
 * the same way the files on disk are read.
 */
export function parseWorkflow(text: string, file: string): Workflow {
  const parsed = parseYaml(text) as { readonly jobs?: Record<string, RawJob> };
  const jobs = Object.entries(parsed.jobs ?? {}).map(([key, job]) => ({
    key,
    name: job.name ?? key,
    steps: (job.steps ?? []).map((step, index) => ({
      label: step.name ?? step.uses ?? `step ${index + 1}`,
      uses: step.uses,
      run: step.run,
      with: step.with ?? {},
    })),
    matrix: job.strategy?.matrix,
    image: containerImage(job.container),
    runsOn: runnerLabel(job['runs-on']),
    if: job.if,
  }));
  return { file, text, jobs };
}

/** Every workflow file, in a stable order. */
export const workflowFiles: readonly Workflow[] = readdirSync(WORKFLOWS_DIR)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort()
  .map((name) => loadWorkflow(name));

export const ci: Workflow = loadWorkflow('ci.yml');
export const release: Workflow = loadWorkflow('release.yml');

/** The job of a workflow, by its mapping key. */
export function jobOf(workflow: Workflow, key: string): Job | undefined {
  return workflow.jobs.find((job) => job.key === key);
}

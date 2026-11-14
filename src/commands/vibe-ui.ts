import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type UiComponentId = 'rating-card' | 'search-bar' | 'citation-badge' | 'evaluator';
export type UiFramework = 'react' | 'html';

export interface VibeUiOptions {
  readonly component?: string | undefined;
  readonly framework?: UiFramework | undefined;
  readonly list?: boolean | undefined;
  readonly write?: string | undefined;
  readonly cwd?: string | undefined;
}

export interface ComponentDefinition {
  readonly id: UiComponentId;
  readonly name: string;
  readonly description: string;
  readonly reactSnippet: string;
  readonly htmlSnippet: string;
}

export const VIBE_UI_COMPONENTS: readonly ComponentDefinition[] = [
  {
    id: 'rating-card',
    name: 'Disability Rating Card',
    description:
      'Clean Tailwind card for Title 38 diagnostic codes, rating criteria, and verification links.',
    reactSnippet: `import React from 'react';

export interface DisabilityRatingCardProps {
  citation: string;
  diagnosticCode: string;
  ratingPercent: number;
  conditionName: string;
  criteria: string;
  sourceUrl?: string;
}

export function DisabilityRatingCard({
  citation,
  diagnosticCode,
  ratingPercent,
  conditionName,
  criteria,
  sourceUrl,
}: DisabilityRatingCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              DC {diagnosticCode}
            </span>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              38 C.F.R. § {citation}
            </span>
          </div>
          <h3 className="mt-1.5 text-base font-semibold text-slate-900 dark:text-white">
            {conditionName}
          </h3>
        </div>
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-lg font-bold text-white shadow-sm">
          {ratingPercent}%
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
        {criteria}
      </p>
      {sourceUrl && (
        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            Verify at eCFR.gov →
          </a>
        </div>
      )}
    </div>
  );
}`,
    htmlSnippet: `<!-- Disability Rating Card (Tailwind CSS) -->
<div class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
  <div class="flex items-start justify-between gap-4">
    <div>
      <div class="flex items-center gap-2">
        <span class="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          DC 6260
        </span>
        <span class="text-xs font-medium text-slate-500 dark:text-slate-400">
          38 C.F.R. § 4.87
        </span>
      </div>
      <h3 class="mt-1.5 text-base font-semibold text-slate-900 dark:text-white">
        Tinnitus, recurrent
      </h3>
    </div>
    <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-lg font-bold text-white shadow-sm">
      10%
    </div>
  </div>
  <p class="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
    Persistent as a symptom of head injury, concussion, acoustic trauma, or following otitis media.
  </p>
</div>`,
  },
  {
    id: 'search-bar',
    name: 'Statutory CFR Search Bar',
    description: 'Debounced search bar with clinical term shortcuts and live feedback.',
    reactSnippet: `import React, { useState } from 'react';

export interface CfrSearchBarProps {
  onSearch: (query: string, semantic: boolean) => void;
  isLoading?: boolean;
}

export function CfrSearchBar({ onSearch, isLoading = false }: CfrSearchBarProps) {
  const [query, setQuery] = useState('');
  const [semantic, setSemantic] = useState(true);

  const shortcuts = ['Tinnitus', 'PTSD 9411', 'Sleep Apnea', 'Back Pain'];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim().length >= 3) {
      onSearch(query.trim(), semantic);
    }
  };

  return (
    <div className="w-full space-y-3">
      <form onSubmit={handleSubmit} className="relative flex items-center">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Title 38 (e.g. 'ringing in ears', '4.130', 'sleep apnea')..."
          className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-4 pr-28 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        />
        <button
          type="submit"
          disabled={isLoading || query.trim().length < 3}
          className="absolute right-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {isLoading ? 'Searching...' : 'Search'}
        </button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <div className="flex items-center gap-1.5">
          <span>Quick queries:</span>
          {shortcuts.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setQuery(s);
                onSearch(s, semantic);
              }}
              className="rounded bg-slate-100 px-2 py-0.5 text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
            >
              {s}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={semantic}
            onChange={(e) => setSemantic(e.target.checked)}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span>Clinical semantic mapping</span>
        </label>
      </div>
    </div>
  );
}`,
    htmlSnippet: `<!-- Statutory Search Bar (Tailwind CSS) -->
<form class="relative flex items-center w-full">
  <input
    type="text"
    placeholder="Search Title 38 (e.g. 'ringing in ears', '4.130')..."
    class="w-full rounded-xl border border-slate-300 bg-white py-3 pl-4 pr-28 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
  />
  <button
    type="submit"
    class="absolute right-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
  >
    Search
  </button>
</form>`,
  },
  {
    id: 'citation-badge',
    name: 'Citation & Verification Badge',
    description: 'Compact legal badge with eCFR permalink and statutory display citation.',
    reactSnippet: `import React from 'react';

export interface CitationBadgeProps {
  citation: string;
  sourceUrl?: string;
  issueDate?: string;
}

export function CitationBadge({ citation, sourceUrl, issueDate }: CitationBadgeProps) {
  return (
    <a
      href={sourceUrl ?? ('https://www.ecfr.gov/current/title-38/section-' + citation)}
      target="_blank"
      rel="noreferrer"
      title={issueDate ? ('Indexed revision: ' + issueDate) : 'Official eCFR text'}
      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-800 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      <span>38 C.F.R. § {citation}</span>
    </a>
  );
}`,
    htmlSnippet: `<!-- Citation Badge (Tailwind CSS) -->
<a
  href="https://www.ecfr.gov/current/title-38/section-4.130"
  target="_blank"
  rel="noreferrer"
  class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-800 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
>
  <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
  <span>38 C.F.R. § 4.130</span>
</a>`,
  },
  {
    id: 'evaluator',
    name: 'Combined Ratings Calculator & Claim Evaluator',
    description:
      'Interactive disability claim evaluator computing VA math (§ 4.25) across disabilities.',
    reactSnippet: `import React, { useState } from 'react';

export function CombinedRatingsEvaluator() {
  const [ratings, setRatings] = useState<number[]>([50, 30, 10]);

  // § 4.25 Combined ratings formula (Table I intermediate whole-number rounding)
  const calculateCombined = (arr: number[]) => {
    if (arr.length === 0) return { raw: '0', final: 0 };
    const sorted = [...arr].sort((a, b) => b - a);
    let combined = sorted[0]!;
    for (let i = 1; i < sorted.length; i++) {
      const effBefore = 100 - combined;
      combined = Math.round(combined + (sorted[i]! * effBefore) / 100);
    }
    const remainder = combined % 10;
    const final = remainder >= 5 ? Math.ceil(combined / 10) * 10 : Math.floor(combined / 10) * 10;
    return { raw: combined.toString(), final: Math.min(100, final) };
  };

  const combined = calculateCombined(ratings);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            Combined Rating Evaluator (38 C.F.R. § 4.25)
          </h3>
          <p className="text-xs text-slate-500">Non-linear whole-person efficiency algorithm</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-blue-600">{combined.final}%</div>
          <div className="text-xs text-slate-400">Raw: {combined.raw}%</div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {ratings.map((r, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {r}%
            <button
              onClick={() => setRatings(ratings.filter((_, idx) => idx !== i))}
              className="text-slate-400 hover:text-rose-500"
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}`,
    htmlSnippet: `<!-- Combined Ratings Box (Tailwind CSS) -->
<div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
  <div class="flex items-center justify-between">
    <div>
      <h3 class="text-lg font-semibold text-slate-900 dark:text-white">
        Combined Rating (38 C.F.R. § 4.25)
      </h3>
      <p class="text-xs text-slate-500">Non-linear VA math evaluation</p>
    </div>
    <div class="text-3xl font-bold text-blue-600">70%</div>
  </div>
</div>`,
  },
];

/** Run the `cfr-free vibe ui` command. */
export function runVibeUiCommand(options: VibeUiOptions): {
  output: string;
  writtenPath?: string | undefined;
} {
  const framework: UiFramework = options.framework ?? 'react';

  if (options.list === true || !options.component) {
    const lines = [
      '# Available Vibe UI Components (Tailwind & v0 / Lovable ready):\n',
      ...VIBE_UI_COMPONENTS.map(
        (c) => '  • ' + c.id.padEnd(16) + ' - ' + c.name + ': ' + c.description,
      ),
      '',
      'Usage: cfr-free vibe ui <component> [--framework react|html] [--write filepath]',
      'Example: cfr-free vibe ui rating-card --framework react > RatingCard.tsx',
    ];
    return { output: lines.join('\n') + '\n' };
  }

  const match = VIBE_UI_COMPONENTS.find((c) => c.id === options.component);
  if (!match) {
    const valid = VIBE_UI_COMPONENTS.map((c) => c.id).join(', ');
    throw new Error(`Unknown component '${options.component}'. Available components: ${valid}`);
  }

  const snippet = framework === 'html' ? match.htmlSnippet : match.reactSnippet;

  if (options.write) {
    const cwd = options.cwd ?? process.cwd();
    const targetPath = path.isAbsolute(options.write)
      ? options.write
      : path.join(cwd, options.write);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, snippet + '\n', 'utf8');
    return {
      output: `✓ Saved ${match.id} (${framework}) to ${targetPath}\n`,
      writtenPath: targetPath,
    };
  }

  return { output: snippet + '\n' };
}

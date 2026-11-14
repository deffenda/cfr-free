/**
 * Semantic & clinical query expansion for Title 38.
 *
 * Maps conversational/clinical complaints (e.g. "ringing in ears", "sleep apnea",
 * "migraines", "back pain") to official Title 38 diagnostic codes, schedule
 * sections, and statutory terminology.
 */

export interface SemanticMapping {
  readonly canonicalName: string;
  readonly diagnosticCode: string;
  readonly citation: string;
  readonly statutoryKeywords: readonly string[];
  readonly triggers: readonly string[];
}

export const CLINICAL_SEMANTIC_MAP: readonly SemanticMapping[] = [
  {
    canonicalName: 'Tinnitus',
    diagnosticCode: '6260',
    citation: '4.87',
    statutoryKeywords: ['tinnitus', 'recurrent', 'acoustic trauma', 'otitis media', '6260'],
    triggers: [
      'ringing in ear',
      'ringing in ears',
      'ear ringing',
      'ringing ears',
      'buzzing in ear',
      'buzzing ears',
      'tinnitus',
    ],
  },
  {
    canonicalName: 'Sleep Apnea Syndromes',
    diagnosticCode: '6847',
    citation: '4.97',
    statutoryKeywords: [
      'sleep apnea',
      'obstructive',
      'cpap',
      'hypersomnolence',
      'tracheostomy',
      '6847',
    ],
    triggers: [
      'sleep apnea',
      'apnea',
      'cpap',
      'snoring',
      'daytime sleepiness',
      'hypersomnolence',
      'breathing machine',
    ],
  },
  {
    canonicalName: 'Post-Traumatic Stress Disorder (PTSD)',
    diagnosticCode: '9411',
    citation: '4.130',
    statutoryKeywords: [
      'ptsd',
      'post-traumatic stress',
      'mental disorders',
      'occupational impairment',
      '9411',
    ],
    triggers: [
      'ptsd',
      'post traumatic',
      'post-traumatic',
      'trauma',
      'flashbacks',
      'nightmares',
      'panic attacks',
    ],
  },
  {
    canonicalName: 'Lumbosacral or Cervical Spine Strain',
    diagnosticCode: '5237',
    citation: '4.71a',
    statutoryKeywords: [
      'lumbosacral',
      'cervical',
      'spine',
      'intervertebral disc',
      'flexion',
      '5237',
    ],
    triggers: [
      'back pain',
      'lower back',
      'neck pain',
      'lumbar',
      'lumbosacral',
      'spine',
      'cervical strain',
      'degenerative disc',
      'herniated disc',
    ],
  },
  {
    canonicalName: 'Migraine / Neurological Headaches',
    diagnosticCode: '8100',
    citation: '4.124a',
    statutoryKeywords: ['migraine', 'headache', 'prostrating', '8100'],
    triggers: ['migraine', 'migraines', 'headache', 'headaches', 'prostrating', 'cluster headache'],
  },
  {
    canonicalName: 'Gastroesophageal Reflux Disease (GERD)',
    diagnosticCode: '7346',
    citation: '4.114',
    statutoryKeywords: ['hernia', 'hiatal', 'esophagus', 'reflux', 'heartburn', '7346'],
    triggers: ['gerd', 'acid reflux', 'reflux', 'heartburn', 'hiatal hernia', 'esophagitis'],
  },
  {
    canonicalName: 'Flatfoot (Pes Planus)',
    diagnosticCode: '5276',
    citation: '4.71a',
    statutoryKeywords: ['flatfoot', 'pes planus', 'pronation', 'inward', 'arch', '5276'],
    triggers: ['flat feet', 'flat foot', 'flatfoot', 'pes planus', 'fallen arches', 'arch pain'],
  },
  {
    canonicalName: 'Sciatica / Radiculopathy',
    diagnosticCode: '8520',
    citation: '4.124a',
    statutoryKeywords: ['sciatic', 'radiculopathy', 'paralysis', 'impairment', '8520'],
    triggers: [
      'sciatica',
      'radiculopathy',
      'sciatic nerve',
      'numbness in leg',
      'tingling in legs',
      'pinched nerve leg',
    ],
  },
  {
    canonicalName: 'Knee Limitation of Flexion',
    diagnosticCode: '5260',
    citation: '4.71a',
    statutoryKeywords: ['knee', 'flexion', 'limitation', 'motion', '5260'],
    triggers: [
      'knee pain',
      'knee flexion',
      'knee limitation',
      'patellofemoral',
      'meniscus',
      'knee stiffness',
    ],
  },
  {
    canonicalName: 'Major Depressive Disorder / Anxiety',
    diagnosticCode: '9434',
    citation: '4.130',
    statutoryKeywords: [
      'depression',
      'anxiety',
      'mental disorders',
      'general rating formula',
      '9434',
    ],
    triggers: [
      'depression',
      'major depressive',
      'depressive disorder',
      'generalized anxiety',
      'anxiety disorder',
    ],
  },
];

export interface SemanticExpansionResult {
  readonly originalQuery: string;
  readonly expandedQuery: string;
  readonly matches: readonly {
    readonly canonicalName: string;
    readonly diagnosticCode: string;
    readonly citation: string;
  }[];
  readonly addedTerms: readonly string[];
}

/** Expand a user's natural language query with clinical/statutory Title 38 terms. */
export function expandSemanticQuery(rawQuery: string): SemanticExpansionResult {
  const normalized = rawQuery.toLowerCase().trim();
  const matchedMappings: SemanticMapping[] = [];
  const addedTermsSet = new Set<string>();

  for (const mapping of CLINICAL_SEMANTIC_MAP) {
    for (const trigger of mapping.triggers) {
      if (normalized.includes(trigger)) {
        matchedMappings.push(mapping);
        for (const term of mapping.statutoryKeywords) {
          if (!normalized.includes(term.toLowerCase())) {
            addedTermsSet.add(term);
          }
        }
        break; // Match each mapping at most once
      }
    }
  }

  if (matchedMappings.length === 0) {
    return {
      originalQuery: rawQuery,
      expandedQuery: rawQuery,
      matches: [],
      addedTerms: [],
    };
  }

  const addedTerms = Array.from(addedTermsSet);
  const matches = matchedMappings.map((m) => ({
    canonicalName: m.canonicalName,
    diagnosticCode: m.diagnosticCode,
    citation: m.citation,
  }));

  // Build expanded query: keep user query as primary, add diagnostic codes and canonical names
  const extraTokens: string[] = [];
  for (const m of matchedMappings) {
    if (!normalized.includes(m.diagnosticCode)) extraTokens.push(m.diagnosticCode);
    if (!normalized.includes(m.canonicalName.toLowerCase())) extraTokens.push(m.canonicalName);
  }

  const expandedQuery = extraTokens.length > 0 ? `${rawQuery} ${extraTokens.join(' ')}` : rawQuery;

  return {
    originalQuery: rawQuery,
    expandedQuery,
    matches,
    addedTerms,
  };
}

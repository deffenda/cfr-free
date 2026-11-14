import { Store } from './store.js';
import type { RawSection } from './xml.js';

export const DEMO_ISSUE_DATE = '2026-10-09';

/**
 * Curated core Title 38 CFR provisions covering common VA disability rating
 * schedules, service connection rules, and diagnostic criteria for instant
 * offline development and sandboxing.
 */
export const DEMO_SECTIONS: readonly RawSection[] = [
  {
    citation: '3.303',
    kind: 'section',
    heading: 'Principles relating to service connection.',
    chapter: 'I',
    subchapter: 'A',
    part: '3',
    subpart: 'A',
    subjectGroup: null,
    path: '/title:38/chapter:I/part:3/subpart:A',
    text:
      '§ 3.303 Principles relating to service connection.\n\n' +
      '(a) General. Service connection connotes many factors but basically it means that the disability resulted from an injury or disease incurred in or aggravated by active military, naval, or air service.\n\n' +
      '(b) Chronicity and continuity. With chronic disease shown as such in service so as to permit a finding of service connection, subsequent manifestations of the same chronic disease at any later date, however remote, are service connected.\n\n' +
      '(d) Postservice initial diagnosis. Service connection may be granted for disability diagnosed after discharge if all evidence establishes that the disease was incurred during service.',
    markdown:
      '### § 3.303 Principles relating to service connection.\n\n' +
      '(a) **General.** Service connection connotes many factors but basically it means that the disability resulted from an injury or disease incurred in or aggravated by active military, naval, or air service.\n\n' +
      '(b) **Chronicity and continuity.** With chronic disease shown as such in service so as to permit a finding of service connection, subsequent manifestations of the same chronic disease at any later date, however remote, are service connected.\n\n' +
      '(d) **Postservice initial diagnosis.** Service connection may be granted for disability diagnosed after discharge if all evidence establishes that the disease was incurred during service.',
  },
  {
    citation: '4.71a',
    kind: 'section',
    heading: 'Schedule of ratings - musculoskeletal system.',
    chapter: 'I',
    subchapter: 'A',
    part: '4',
    subpart: 'B',
    subjectGroup: null,
    path: '/title:38/chapter:I/part:4/subpart:B',
    text:
      '§ 4.71a Schedule of ratings - musculoskeletal system.\n\n' +
      'Diagnostic Code 5237: Lumbosacral strain.\n' +
      'With forward flexion of the thoracolumbar spine 30 degrees or less: 40%.\n' +
      'With forward flexion of the thoracolumbar spine greater than 30 degrees but not greater than 60 degrees: 20%.\n' +
      'With forward flexion of the thoracolumbar spine greater than 60 degrees but not greater than 85 degrees: 10%.',
    markdown:
      '### § 4.71a Schedule of ratings - musculoskeletal system.\n\n' +
      '| Diagnostic Code | Condition and Disability Rating Criteria | Rating |\n' +
      '| --- | --- | --- |\n' +
      '| 5237 | Lumbosacral strain with forward flexion 30 degrees or less | 40% |\n' +
      '| 5237 | Forward flexion greater than 30 degrees but not greater than 60 degrees | 20% |\n' +
      '| 5237 | Forward flexion greater than 60 degrees but not greater than 85 degrees | 10% |',
  },
  {
    citation: '4.87',
    kind: 'section',
    heading: 'Schedule of ratings - ear.',
    chapter: 'I',
    subchapter: 'A',
    part: '4',
    subpart: 'B',
    subjectGroup: null,
    path: '/title:38/chapter:I/part:4/subpart:B',
    text:
      '§ 4.87 Schedule of ratings - ear.\n\n' +
      'Diagnostic Code 6260: Tinnitus, recurrent.\n' +
      'Persistent as a symptom of head injury, concussion, acoustic trauma, or following otitis media: 10%.\n\n' +
      'Note: A single 10 percent evaluation is assigned for recurrent tinnitus, whether unilateral or bilateral.',
    markdown:
      '### § 4.87 Schedule of ratings - ear.\n\n' +
      '| Diagnostic Code | Disability | Rating |\n' +
      '| --- | --- | --- |\n' +
      '| 6260 | Tinnitus, recurrent (persistent as symptom of acoustic trauma; single rating whether unilateral or bilateral) | 10% |',
  },
  {
    citation: '4.97',
    kind: 'section',
    heading: 'Schedule of ratings - respiratory system.',
    chapter: 'I',
    subchapter: 'A',
    part: '4',
    subpart: 'B',
    subjectGroup: null,
    path: '/title:38/chapter:I/part:4/subpart:B',
    text:
      '§ 4.97 Schedule of ratings - respiratory system.\n\n' +
      'Diagnostic Code 6847: Sleep apnea syndromes (obstructive, central, or mixed).\n' +
      'Chronic respiratory failure with carbon dioxide retention or cor pulmonale, or requires tracheostomy: 100%.\n' +
      'Requires use of breathing assistance device such as continuous airway pressure (CPAP) machine: 50%.\n' +
      'Persistent daytime hypersomnolence: 30%.\n' +
      'Asymptomatic but with documented sleep disorder breathing: 0%.',
    markdown:
      '### § 4.97 Schedule of ratings - respiratory system.\n\n' +
      '| Diagnostic Code | Condition and Disability Criteria | Rating |\n' +
      '| --- | --- | --- |\n' +
      '| 6847 | Sleep apnea syndromes with chronic respiratory failure or tracheostomy | 100% |\n' +
      '| 6847 | Requires use of breathing assistance device such as CPAP machine | 50% |\n' +
      '| 6847 | Persistent daytime hypersomnolence | 30% |\n' +
      '| 6847 | Asymptomatic with documented sleep disorder breathing | 0% |',
  },
  {
    citation: '4.130',
    kind: 'section',
    heading: 'Schedule of ratings for mental disorders.',
    chapter: 'I',
    subchapter: 'A',
    part: '4',
    subpart: 'B',
    subjectGroup: null,
    path: '/title:38/chapter:I/part:4/subpart:B',
    text:
      '§ 4.130 Schedule of ratings for mental disorders.\n\n' +
      'Diagnostic Code 9411: Post-traumatic stress disorder (PTSD).\n\n' +
      'General Rating Formula for Mental Disorders:\n' +
      'Total occupational and social impairment: 100%.\n' +
      'Occupational and social impairment with deficiencies in most areas (suicidal ideation, obsessional rituals, panic attacks): 70%.\n' +
      'Occupational and social impairment with reduced reliability and productivity (flattened affect, panic attacks > once a week): 50%.\n' +
      'Occupational and social impairment with occasional decrease in work efficiency: 30%.\n' +
      'Occupational and social impairment due to mild or transient symptoms: 10%.\n' +
      'Formally diagnosed condition with symptoms not severe enough to interfere with occupational and social functioning: 0%.',
    markdown:
      '### § 4.130 Schedule of ratings for mental disorders.\n\n' +
      '| Rating | General Rating Formula for Mental Disorders (DC 9411 PTSD, depression, anxiety) |\n' +
      '| --- | --- |\n' +
      '| 100% | Total occupational and social impairment (delusions, hallucinations, gross impairment) |\n' +
      '| 70% | Deficiencies in most areas (suicidal ideation, obsessional rituals, frequent panic attacks) |\n' +
      '| 50% | Reduced reliability and productivity (flattened affect, panic attacks > once a week) |\n' +
      '| 30% | Occasional decrease in work efficiency with intermittent periods of inability to perform tasks |\n' +
      '| 10% | Mild or transient symptoms during periods of significant stress |\n' +
      '| 0% | Formally diagnosed condition with symptoms not interfering with functioning |',
  },
];

/** Open an in-memory SQLite store populated with the demo provisions. */
export function openDemoStore(): Store {
  const store = Store.open(':memory:');
  store.replaceAll(DEMO_SECTIONS, DEMO_ISSUE_DATE, {
    issue_date: DEMO_ISSUE_DATE,
    'parser-version': 'vibe-demo-v1',
  });
  return store;
}

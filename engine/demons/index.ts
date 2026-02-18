/**
 * Demon Registry — All seed demons in one place.
 *
 * Each demon is a pure function: takes working memory → returns mutations.
 * The hypervisor decides which demons fire and in what order.
 *
 * Demon pipeline (typical flow for a question):
 *
 *   User Input
 *       ↓
 *   [parse] → extracts intent, subject, noun phrases
 *       ↓
 *   [relate] → finds knowledge graph connections
 *       ↓
 *   [infer] → derives new knowledge via logic rules
 *       ↓
 *   [decompose] → breaks complex concepts into parts
 *       ↓
 *   [analogize] → finds structural analogies
 *       ↓
 *   [question] → generates Socratic response
 *       ↓
 *   [learn] → persists new knowledge to graph
 */

import type { Demon } from '../core/types.js';
import { parseDemon } from './parse.js';
import { relateDemon } from './relate.js';
import { inferDemon } from './infer.js';
import { decomposeDemon } from './decompose.js';
import { analogizeDemon } from './analogize.js';
import { questionDemon } from './question.js';
import { learnDemon } from './learn.js';

/** All registered demons, keyed by ID. */
export const DEMONS: Map<string, Demon> = new Map([
  ['parse', parseDemon],
  ['relate', relateDemon],
  ['infer', inferDemon],
  ['decompose', decomposeDemon],
  ['analogize', analogizeDemon],
  ['question', questionDemon],
  ['learn', learnDemon],
]);

/** Get a demon by ID. */
export function getDemon(id: string): Demon | undefined {
  return DEMONS.get(id);
}

/** Get all demons that should fire for a given trigger condition. */
export function getTriggeredDemons(
  condition: { type: string; tag?: string; from?: string; tick?: number },
): Demon[] {
  const triggered: Demon[] = [];

  for (const demon of DEMONS.values()) {
    for (const trigger of demon.triggers) {
      if (trigger.type === condition.type) {
        switch (trigger.type) {
          case 'always':
            triggered.push(demon);
            break;
          case 'new_input':
            triggered.push(demon);
            break;
          case 'tag_present':
            if (condition.tag === trigger.tag) triggered.push(demon);
            break;
          case 'tag_absent':
            if (condition.tag === trigger.tag) triggered.push(demon);
            break;
          case 'chain':
            if (condition.from === trigger.from) triggered.push(demon);
            break;
          case 'tick_interval':
            if (condition.tick && condition.tick % trigger.every === 0) triggered.push(demon);
            break;
        }
      }
    }
  }

  return triggered;
}

export { parseDemon, relateDemon, inferDemon, decomposeDemon, analogizeDemon, questionDemon, learnDemon };

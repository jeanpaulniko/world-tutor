/**
 * Learn Demon — Persists new knowledge to the graph.
 *
 * After the reasoning chain completes, this demon reviews what
 * was discussed and stores new concepts and relations in the
 * persistent knowledge graph for future conversations.
 *
 * It also tracks the student's learning progress: what they
 * know, what they're confused about, what they've mastered.
 *
 * Maps to RTSG Section 25: "Cognitive Memory Architecture" —
 * the learn demon manages the transfer from working memory
 * (short-term, volatile) to the knowledge graph (long-term, persistent).
 */

import type { Demon, DemonOutput, DemonInput, MemSlot, NounType, RelationType } from '../core/types.js';
import { findByTag, latestByTag } from '../memory/working-memory.js';
import { ensureNoun, link, findNoun, createRelation } from '../store/knowledge-graph.js';

/** Determine noun type from context. */
function inferNounType(label: string, subject: string): NounType {
  const lower = label.toLowerCase();

  // Numbers and values
  if (/^\d+(\.\d+)?(%|°|m\/s|kg|cm|mm|km|g|mg|L|mL)?$/.test(lower)) return 'value';
  if (/^(true|false|yes|no)$/.test(lower)) return 'value';

  // Processes (words ending in -ing, -tion, -sis)
  if (/ing$|tion$|sis$|ment$/.test(lower)) return 'process';

  // Properties (words ending in -ness, -ity, -ful, -ous)
  if (/ness$|ity$|ful$|ous$|ive$|able$/.test(lower)) return 'property';

  // Context (subject names)
  if (['mathematics', 'physics', 'chemistry', 'biology', 'history', 'language', 'computer_science', 'geography', 'economics'].includes(lower)) {
    return 'context';
  }

  // Default to concept (abstract idea)
  return 'concept';
}

/** Extract plausible relations from what the student said. */
function extractImpliedRelations(text: string): Array<{
  from: string;
  type: RelationType;
  to: string;
}> {
  const relations: Array<{ from: string; type: RelationType; to: string }> = [];
  const lower = text.toLowerCase();

  // "X is a/an Y" → is_a
  const isAPattern = /(\w[\w\s]*?)\s+is\s+(?:a|an)\s+(\w[\w\s]*?)(?:\.|,|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = isAPattern.exec(lower)) !== null) {
    relations.push({ from: match[1].trim(), type: 'is_a', to: match[2].trim() });
  }

  // "X causes Y" / "X leads to Y" → causes
  const causesPattern = /(\w[\w\s]*?)\s+(?:causes|leads?\s+to|results?\s+in)\s+(\w[\w\s]*?)(?:\.|,|$)/gi;
  while ((match = causesPattern.exec(lower)) !== null) {
    relations.push({ from: match[1].trim(), type: 'causes', to: match[2].trim() });
  }

  // "X has Y" / "X contains Y" → has
  const hasPattern = /(\w[\w\s]*?)\s+(?:has|have|contains?)\s+(\w[\w\s]*?)(?:\.|,|$)/gi;
  while ((match = hasPattern.exec(lower)) !== null) {
    relations.push({ from: match[1].trim(), type: 'has', to: match[2].trim() });
  }

  // "X is part of Y" → part_of
  const partPattern = /(\w[\w\s]*?)\s+is\s+(?:part\s+of|a\s+component\s+of)\s+(\w[\w\s]*?)(?:\.|,|$)/gi;
  while ((match = partPattern.exec(lower)) !== null) {
    relations.push({ from: match[1].trim(), type: 'part_of', to: match[2].trim() });
  }

  // "X requires Y" / "X needs Y" → requires
  const reqPattern = /(\w[\w\s]*?)\s+(?:requires?|needs?)\s+(\w[\w\s]*?)(?:\.|,|$)/gi;
  while ((match = reqPattern.exec(lower)) !== null) {
    relations.push({ from: match[1].trim(), type: 'requires', to: match[2].trim() });
  }

  // "X equals Y" / "X is equal to Y" → equals
  const eqPattern = /(\w[\w\s]*?)\s+(?:equals?|is\s+equal\s+to|=)\s+(\w[\w\s]*?)(?:\.|,|$)/gi;
  while ((match = eqPattern.exec(lower)) !== null) {
    relations.push({ from: match[1].trim(), type: 'equals', to: match[2].trim() });
  }

  // "X is used for Y" → used_for
  const usedPattern = /(\w[\w\s]*?)\s+is\s+used\s+(?:for|to)\s+(\w[\w\s]*?)(?:\.|,|$)/gi;
  while ((match = usedPattern.exec(lower)) !== null) {
    relations.push({ from: match[1].trim(), type: 'used_for', to: match[2].trim() });
  }

  return relations;
}

export const learnDemon: Demon = {
  id: 'learn',
  name: 'Learn',
  description: 'Persists new concepts and relations to the knowledge graph after reasoning.',
  triggers: [
    { type: 'tag_present', tag: 'response' },  // After a response is generated
    { type: 'tick_interval', every: 5 },        // Also periodic consolidation
  ],

  run(input: DemonInput): DemonOutput {
    const actions: DemonOutput['actions'] = [];
    const write: Omit<MemSlot, 'id' | 'created_at'>[] = [];

    const subjectSlot = latestByTag(input.memory, 'subject');
    const subject = subjectSlot ? String(subjectSlot.content) : 'general';

    let storedNouns = 0;
    let storedRelations = 0;

    // Phase 1: Store noun phrases we encountered
    const nounSlots = findByTag(input.memory, 'noun_phrase');
    for (const slot of nounSlots) {
      const label = String(slot.content);
      if (label.length < 2 || label.length > 100) continue; // Skip garbage

      const type = inferNounType(label, subject);
      ensureNoun(label, type);
      storedNouns++;
    }

    // Phase 2: Store the subject as a context noun
    if (subject !== 'general') {
      ensureNoun(subject, 'context');
    }

    // Phase 3: Extract and store implicit relations from the raw input
    const rawSlot = latestByTag(input.memory, 'raw_input');
    if (rawSlot) {
      const text = String(rawSlot.content);
      const impliedRelations = extractImpliedRelations(text);

      for (const rel of impliedRelations) {
        try {
          // Link automatically creates nouns if they don't exist
          link(rel.from, rel.type, rel.to, 0.6, subject !== 'general' ? subject : undefined);
          storedRelations++;
        } catch (err) {
          // Non-critical — just log and move on
          actions.push({ type: 'log', message: `Learn: failed to store relation ${rel.from} -${rel.type}-> ${rel.to}` });
        }
      }
    }

    // Phase 4: Store confirmed relations from the reasoning chain
    const confirmedRels = findByTag(input.memory, 'relation');
    for (const slot of confirmedRels) {
      if (slot.confidence < 0.5) continue; // Only store confident relations
      const rel = slot.content as { from: string; type: string; to: string; weight: number };
      try {
        link(rel.from, rel.type as RelationType, rel.to, rel.weight, subject !== 'general' ? subject : undefined);
        storedRelations++;
      } catch {
        // Skip on error
      }
    }

    // Phase 5: Track student state
    const intentSlot = latestByTag(input.memory, 'intent');
    const intent = intentSlot ? String(intentSlot.content) : 'unknown';
    const focusSlot = latestByTag(input.memory, 'question_focus');
    const focus = focusSlot ? String(focusSlot.content) : '';

    // Record what the student is working on
    if (focus) {
      const studentNode = ensureNoun('student', 'entity');
      const topicNode = ensureNoun(focus, 'concept');

      // Create a "studying" relation
      try {
        const existingStudying = findByTag(input.memory, 'student_topic');
        if (existingStudying.length === 0) {
          createRelation(studentNode.id, topicNode.id, 'relates_to', 0.8, undefined, {
            type: 'currently_studying',
            timestamp: Date.now(),
          });
        }
      } catch {
        // Non-critical
      }

      write.push({
        content: { topic: focus, subject, intent },
        tag: 'student_topic',
        confidence: 0.9,
        source_demon: 'learn',
        ttl: 30, // Remember what we're studying for a while
      });
    }

    // Track confusion for adaptive teaching
    if (intent === 'confusion') {
      write.push({
        content: { confused_about: focus, subject, tick: input.memory.tick },
        tag: 'student_confusion',
        confidence: 0.9,
        source_demon: 'learn',
        ttl: 50, // Remember confusion points longer
      });
    }

    actions.push({
      type: 'log',
      message: `Learn: stored ${storedNouns} nouns, ${storedRelations} relations`,
    });

    return {
      write: write as MemSlot[],
      evict: [],
      focus: [],
      actions,
      chain: [], // Terminal
    };
  },
};

/**
 * Relate Demon — Connects concepts by querying the knowledge graph.
 *
 * Takes noun phrases from working memory and finds how they relate
 * to each other and to existing knowledge. Loads relevant relations
 * into working memory so other demons (infer, analogize) can use them.
 *
 * Maps to RTSG Section 13: "Concept Spheres" — each noun occupies a
 * region in the 8D intelligence space, and relations define the
 * adjacency/overlap structure (the nerve complex).
 */

import type { Demon, DemonOutput, DemonInput, MemSlot, Relation, Noun } from '../core/types.js';
import { findByTag, latestByTag } from '../memory/working-memory.js';
import { findNoun, searchNouns, relationsFrom, relationsTo, query, ensureNoun, link } from '../store/knowledge-graph.js';

export const relateDemon: Demon = {
  id: 'relate',
  name: 'Relate',
  description: 'Queries knowledge graph for relations between concepts in working memory.',
  triggers: [
    { type: 'chain', from: 'parse' },
    { type: 'tag_present', tag: 'noun_phrase' },
  ],

  run(input: DemonInput): DemonOutput {
    const write: Omit<MemSlot, 'id' | 'created_at'>[] = [];
    const actions: DemonOutput['actions'] = [];
    const chain: string[] = [];

    // Gather all noun phrases from working memory
    const nounSlots = findByTag(input.memory, 'noun_phrase');
    const nouns: string[] = nounSlots.map((s) => String(s.content));

    if (nouns.length === 0) {
      return { write: [] as MemSlot[], evict: [], focus: [], actions: [], chain: [] };
    }

    // Phase 1: Look up each noun in the knowledge graph
    const foundNouns: Map<string, Noun> = new Map();
    const missingNouns: string[] = [];

    for (const label of nouns) {
      const found = findNoun(label);
      if (found) {
        foundNouns.set(label, found);
      } else {
        // Try fuzzy search
        const candidates = searchNouns(label, 3);
        if (candidates.length > 0) {
          foundNouns.set(label, candidates[0]);
          // Note the fuzzy match for potential clarification
          if (candidates[0].label !== label.toLowerCase().trim()) {
            write.push({
              content: { original: label, matched: candidates[0].label, alternatives: candidates.map(c => c.label) },
              tag: 'fuzzy_match',
              confidence: 0.5,
              source_demon: 'relate',
              ttl: 5,
            });
          }
        } else {
          missingNouns.push(label);
        }
      }
    }

    // Phase 2: Find relations between found nouns
    const relationsFound: Array<{ from: string; type: string; to: string; weight: number }> = [];

    const foundEntries = [...foundNouns.entries()];
    for (let i = 0; i < foundEntries.length; i++) {
      const [labelA, nounA] = foundEntries[i];

      // Get all relations FROM this noun
      const rels = relationsFrom(nounA.id);
      for (const rel of rels) {
        // Check if any of our other nouns appear
        for (const [labelB, nounB] of foundNouns) {
          if (rel.to_id === nounB.id) {
            relationsFound.push({
              from: labelA,
              type: rel.type,
              to: labelB,
              weight: rel.weight,
            });
          }
        }
      }

      // Also get hierarchy (is_a, part_of) for context
      const hierarchy = relationsFrom(nounA.id, 'is_a');
      for (const rel of hierarchy) {
        write.push({
          content: { noun: labelA, is_a: rel.to.label },
          tag: 'hierarchy',
          confidence: rel.weight,
          source_demon: 'relate',
          ttl: 8,
        });
      }
    }

    // Phase 3: Write found relations to working memory
    for (const rel of relationsFound) {
      write.push({
        content: rel,
        tag: 'relation',
        confidence: rel.weight,
        source_demon: 'relate',
        ttl: 8,
      });
    }

    // Phase 4: Handle missing nouns — they need to be learned
    if (missingNouns.length > 0) {
      write.push({
        content: missingNouns,
        tag: 'unknown_concepts',
        confidence: 0.9,
        source_demon: 'relate',
        ttl: 5,
      });

      actions.push({
        type: 'log',
        message: `Unknown concepts: [${missingNouns.join(', ')}]`,
      });
    }

    // Phase 5: Context loading — get broader context for the subject
    const subjectSlot = latestByTag(input.memory, 'subject');
    if (subjectSlot && String(subjectSlot.content) !== 'general') {
      const subjectNoun = findNoun(String(subjectSlot.content));
      if (subjectNoun) {
        const contextRels = relationsFrom(subjectNoun.id);
        const contextFacts = contextRels.slice(0, 10); // Don't overload memory
        for (const rel of contextFacts) {
          write.push({
            content: {
              from: subjectNoun.label,
              type: rel.type,
              to: rel.to.label,
              weight: rel.weight,
            },
            tag: 'context_fact',
            confidence: rel.weight * 0.7, // Slightly lower confidence for context
            source_demon: 'relate',
            ttl: 6,
          });
        }
      }
    }

    // Decide what fires next
    if (relationsFound.length > 0) {
      chain.push('infer'); // We have relations, try to infer new knowledge
    }
    if (missingNouns.length > 0) {
      chain.push('question'); // We have unknowns, ask about them
    }
    if (foundNouns.size > 0 && relationsFound.length === 0) {
      chain.push('analogize'); // We found concepts but no direct links — try analogy
    }

    actions.push({
      type: 'log',
      message: `Relate: found=${foundNouns.size}, missing=${missingNouns.length}, relations=${relationsFound.length}`,
    });

    return {
      write: write as MemSlot[],
      evict: [],
      focus: [],
      actions,
      chain,
    };
  },
};

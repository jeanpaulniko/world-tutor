/**
 * Analogize Demon — Finds analogies between concepts.
 *
 * When the student is confused or when concepts lack direct relations,
 * this demon searches for structural similarities between concept
 * neighborhoods in the knowledge graph. Two concepts are analogous
 * if they share similar relation patterns.
 *
 * Maps to RTSG Section 16: "Interaction Matrices K, R, J" —
 * analogy is a high K_ij (synergy) between concepts that share
 * structural patterns despite being in different domains.
 *
 * Example: "electricity flows through wires" is analogous to
 * "water flows through pipes" because both share the pattern:
 * [medium] flows_through [channel], [source] produces [medium].
 */

import type { Demon, DemonOutput, DemonInput, MemSlot, Noun, Relation } from '../core/types.js';
import { findByTag, latestByTag } from '../memory/working-memory.js';
import { findNoun, relationsFrom, relationsTo, searchNouns, query } from '../store/knowledge-graph.js';

/** A structural pattern: the set of relation types emanating from a concept. */
interface RelationPattern {
  noun: string;
  outgoing: Map<string, string[]>;  // relation_type -> [target_labels]
  incoming: Map<string, string[]>;  // relation_type -> [source_labels]
}

/** Extract the relation pattern of a noun from the knowledge graph. */
function extractPattern(nounLabel: string): RelationPattern | null {
  const noun = findNoun(nounLabel);
  if (!noun) return null;

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  const outsRels = relationsFrom(noun.id);
  for (const rel of outsRels) {
    const existing = outgoing.get(rel.type) || [];
    existing.push(rel.to.label);
    outgoing.set(rel.type, existing);
  }

  const insRels = relationsTo(noun.id);
  for (const rel of insRels) {
    const existing = incoming.get(rel.type) || [];
    existing.push(rel.from.label);
    incoming.set(rel.type, existing);
  }

  return { noun: nounLabel, outgoing, incoming };
}

/** Calculate structural similarity between two relation patterns. */
function patternSimilarity(a: RelationPattern, b: RelationPattern): number {
  // Compare outgoing relation type sets
  const aOutTypes = new Set(a.outgoing.keys());
  const bOutTypes = new Set(b.outgoing.keys());

  // Compare incoming relation type sets
  const aInTypes = new Set(a.incoming.keys());
  const bInTypes = new Set(b.incoming.keys());

  // Jaccard similarity of relation types
  const outUnion = new Set([...aOutTypes, ...bOutTypes]);
  const outIntersect = new Set([...aOutTypes].filter((t) => bOutTypes.has(t)));

  const inUnion = new Set([...aInTypes, ...bInTypes]);
  const inIntersect = new Set([...aInTypes].filter((t) => bInTypes.has(t)));

  const outSim = outUnion.size > 0 ? outIntersect.size / outUnion.size : 0;
  const inSim = inUnion.size > 0 ? inIntersect.size / inUnion.size : 0;

  // Weighted combination (outgoing relations are more informative)
  return outSim * 0.6 + inSim * 0.4;
}

/** Find concepts that are structurally similar to the given concept. */
function findAnalogies(conceptLabel: string, limit: number = 3): Array<{
  analog: string;
  similarity: number;
  sharedTypes: string[];
  mapping: Array<{ sourceRel: string; sourceTarget: string; analogRel: string; analogTarget: string }>;
}> {
  const pattern = extractPattern(conceptLabel);
  if (!pattern) return [];

  // Search for other nouns with similar patterns
  // Strategy: look at nouns that share the same relation types
  const candidates = new Set<string>();

  for (const relType of pattern.outgoing.keys()) {
    const results = query({ relation: relType as any });
    for (const r of results) {
      if (r.from.label !== conceptLabel) candidates.add(r.from.label);
    }
  }

  // Score each candidate
  const scored: Array<{
    analog: string;
    similarity: number;
    sharedTypes: string[];
    mapping: Array<{ sourceRel: string; sourceTarget: string; analogRel: string; analogTarget: string }>;
  }> = [];

  for (const candidateLabel of candidates) {
    const candidatePattern = extractPattern(candidateLabel);
    if (!candidatePattern) continue;

    const similarity = patternSimilarity(pattern, candidatePattern);
    if (similarity < 0.3) continue; // Not similar enough

    // Find shared relation types
    const sharedTypes = [...pattern.outgoing.keys()]
      .filter((t) => candidatePattern.outgoing.has(t));

    // Build mapping between corresponding targets
    const mapping: Array<{ sourceRel: string; sourceTarget: string; analogRel: string; analogTarget: string }> = [];
    for (const relType of sharedTypes) {
      const sourceTargets = pattern.outgoing.get(relType) || [];
      const analogTargets = candidatePattern.outgoing.get(relType) || [];
      if (sourceTargets.length > 0 && analogTargets.length > 0) {
        mapping.push({
          sourceRel: relType,
          sourceTarget: sourceTargets[0],
          analogRel: relType,
          analogTarget: analogTargets[0],
        });
      }
    }

    scored.push({ analog: candidateLabel, similarity, sharedTypes, mapping });
  }

  // Sort by similarity, take top N
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}

/** Common analogies that work across domains (hardcoded bootstrapping). */
const COMMON_ANALOGIES: Record<string, Array<{ analog: string; explanation: string }>> = {
  'electricity': [
    { analog: 'water flow', explanation: 'Electricity flows through wires like water flows through pipes. Voltage is like water pressure, current is like flow rate.' },
  ],
  'atom': [
    { analog: 'solar system', explanation: 'An atom is like a tiny solar system: the nucleus is the sun, and electrons orbit around it like planets.' },
  ],
  'cell': [
    { analog: 'factory', explanation: 'A cell is like a factory: it has a control center (nucleus), an energy plant (mitochondria), shipping department (Golgi body), and walls (cell membrane).' },
  ],
  'dna': [
    { analog: 'blueprint', explanation: 'DNA is like a blueprint for a building. It contains all the instructions needed to build and maintain a living thing.' },
  ],
  'variable': [
    { analog: 'box', explanation: 'A variable is like a labeled box. You can put different things inside it, but the label stays the same.' },
  ],
  'function': [
    { analog: 'machine', explanation: 'A function is like a machine: you put something in (input), the machine does something to it, and something comes out (output).' },
  ],
  'evolution': [
    { analog: 'selective breeding', explanation: 'Evolution is like natural selective breeding. Instead of a farmer choosing which animals to breed, the environment \"chooses\" which organisms survive.' },
  ],
  'gravity': [
    { analog: 'magnet', explanation: 'Gravity is like a magnet that pulls everything toward the center of a massive object. The bigger the object, the stronger the pull.' },
  ],
};

export const analogizeDemon: Demon = {
  id: 'analogize',
  name: 'Analogize',
  description: 'Finds structural analogies between concepts to aid understanding.',
  triggers: [
    { type: 'chain', from: 'decompose' },
    { type: 'chain', from: 'relate' },
    { type: 'tag_present', tag: 'simplification_needed' },
  ],

  run(input: DemonInput): DemonOutput {
    const write: Omit<MemSlot, 'id' | 'created_at'>[] = [];
    const actions: DemonOutput['actions'] = [];
    const chain: string[] = [];

    // What concept needs an analogy?
    const focusSlot = latestByTag(input.memory, 'question_focus');
    const nounSlots = findByTag(input.memory, 'noun_phrase');

    const concepts = [
      focusSlot ? String(focusSlot.content) : null,
      ...nounSlots.map((s) => String(s.content)),
    ].filter((c): c is string => c !== null);

    if (concepts.length === 0) {
      return { write: [] as MemSlot[], evict: [], focus: [], actions: [], chain: ['question'] };
    }

    let analogiesFound = 0;

    for (const concept of concepts) {
      // Check hardcoded common analogies first (fast path)
      const conceptLower = concept.toLowerCase();
      const common = COMMON_ANALOGIES[conceptLower];
      if (common) {
        for (const analogy of common) {
          write.push({
            content: {
              concept,
              analog: analogy.analog,
              explanation: analogy.explanation,
              source: 'common_knowledge',
            },
            tag: 'analogy',
            confidence: 0.85,
            source_demon: 'analogize',
            ttl: 0,
          });
          analogiesFound++;
        }
      }

      // Try graph-based structural analogy
      const graphAnalogies = findAnalogies(concept, 2);
      for (const analogy of graphAnalogies) {
        write.push({
          content: {
            concept,
            analog: analogy.analog,
            similarity: analogy.similarity,
            sharedPatterns: analogy.sharedTypes,
            mapping: analogy.mapping,
            source: 'structural_analogy',
          },
          tag: 'analogy',
          confidence: analogy.similarity,
          source_demon: 'analogize',
          ttl: 0,
        });
        analogiesFound++;
      }
    }

    chain.push('question'); // Generate response using the analogies

    actions.push({
      type: 'log',
      message: `Analogize: found ${analogiesFound} analogies for [${concepts.join(', ')}]`,
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

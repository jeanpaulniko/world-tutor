/**
 * Infer Demon — Derives new knowledge from existing relations.
 *
 * Takes the relations currently in working memory and applies
 * logical inference rules to derive new facts. This is the
 * engine's core reasoning step.
 *
 * Inference rules:
 * 1. Transitivity: if A is_a B, and B is_a C, then A is_a C
 * 2. Causation chains: if A causes B, and B causes C, then A (indirectly) causes C
 * 3. Property inheritance: if A is_a B, and B has P, then A has P
 * 4. Contradiction detection: if A equals X and A equals Y where X != Y
 * 5. Implication: if A requires B, and B requires C, then A requires C
 *
 * Maps to RTSG Section 15: "Filter Pipeline" — each inference rule
 * is a composable filter F: ℝ⁸ → ℝ⁸ that transforms the concept space.
 */

import type { Demon, DemonOutput, DemonInput, MemSlot } from '../core/types.js';
import { findByTag, latestByTag } from '../memory/working-memory.js';

interface RelContent {
  from: string;
  type: string;
  to: string;
  weight: number;
}

/** Find transitive relations. If A→B and B→C (same type), infer A→C. */
function inferTransitive(relations: RelContent[], transitiveTypes: Set<string>): RelContent[] {
  const inferred: RelContent[] = [];
  const existing = new Set(relations.map((r) => `${r.from}|${r.type}|${r.to}`));

  for (const r1 of relations) {
    if (!transitiveTypes.has(r1.type)) continue;

    for (const r2 of relations) {
      if (r2.type !== r1.type) continue;
      if (r2.from !== r1.to) continue; // r1.to must be r2.from for transitivity
      if (r2.to === r1.from) continue; // Avoid self-loops

      const key = `${r1.from}|${r1.type}|${r2.to}`;
      if (!existing.has(key)) {
        inferred.push({
          from: r1.from,
          type: r1.type,
          to: r2.to,
          weight: Math.min(r1.weight, r2.weight) * 0.9, // Confidence decreases with chain length
        });
        existing.add(key);
      }
    }
  }

  return inferred;
}

/** Inherit properties through is_a hierarchy. If A is_a B, and B has P, then A has P. */
function inferInheritance(relations: RelContent[]): RelContent[] {
  const inferred: RelContent[] = [];
  const existing = new Set(relations.map((r) => `${r.from}|${r.type}|${r.to}`));

  const isAs = relations.filter((r) => r.type === 'is_a');
  const has = relations.filter((r) => r.type === 'has' || r.type === 'requires');

  for (const isa of isAs) {
    // A is_a B → look for B has P
    for (const prop of has) {
      if (prop.from !== isa.to) continue;

      const key = `${isa.from}|${prop.type}|${prop.to}`;
      if (!existing.has(key)) {
        inferred.push({
          from: isa.from,
          type: prop.type,
          to: prop.to,
          weight: Math.min(isa.weight, prop.weight) * 0.85,
        });
        existing.add(key);
      }
    }
  }

  return inferred;
}

/** Detect contradictions: same subject, contradictory relations. */
function detectContradictions(relations: RelContent[]): Array<{
  concept: string;
  claim1: RelContent;
  claim2: RelContent;
  reason: string;
}> {
  const contradictions: Array<{
    concept: string;
    claim1: RelContent;
    claim2: RelContent;
    reason: string;
  }> = [];

  // Check for conflicting equals
  const equals = relations.filter((r) => r.type === 'equals');
  for (let i = 0; i < equals.length; i++) {
    for (let j = i + 1; j < equals.length; j++) {
      if (equals[i].from === equals[j].from && equals[i].to !== equals[j].to) {
        contradictions.push({
          concept: equals[i].from,
          claim1: equals[i],
          claim2: equals[j],
          reason: `"${equals[i].from}" can't equal both "${equals[i].to}" and "${equals[j].to}"`,
        });
      }
    }
  }

  // Check for opposes + equals (A opposes B, but C equals both)
  const opposes = relations.filter((r) => r.type === 'opposes');
  for (const opp of opposes) {
    for (const eq of equals) {
      if (eq.to === opp.from || eq.to === opp.to) {
        // Something equals an item that opposes another
        const other = eq.to === opp.from ? opp.to : opp.from;
        const otherEq = equals.find((e) => e.from === eq.from && e.to === other);
        if (otherEq) {
          contradictions.push({
            concept: eq.from,
            claim1: eq,
            claim2: otherEq,
            reason: `"${eq.from}" can't equal both "${eq.to}" and "${other}" because they oppose each other`,
          });
        }
      }
    }
  }

  return contradictions;
}

/** Build a confidence assessment of the student's claim. */
function assessClaim(relations: RelContent[], hierarchies: Array<{ noun: string; is_a: string }>): {
  supported: RelContent[];
  unsupported: string[];
  confidence: number;
} {
  const supported = relations.filter((r) => r.weight > 0.5);
  const weak = relations.filter((r) => r.weight <= 0.5 && r.weight > 0);

  // Concepts that appear in relations but don't have graph backing
  const allConcepts = new Set([
    ...relations.map((r) => r.from),
    ...relations.map((r) => r.to),
  ]);
  const knownConcepts = new Set([
    ...hierarchies.map((h) => h.noun),
    ...relations.filter((r) => r.weight > 0.3).flatMap((r) => [r.from, r.to]),
  ]);
  const unsupported = [...allConcepts].filter((c) => !knownConcepts.has(c));

  const confidence = allConcepts.size > 0
    ? supported.length / Math.max(1, allConcepts.size)
    : 0;

  return { supported, unsupported, confidence };
}

export const inferDemon: Demon = {
  id: 'infer',
  name: 'Infer',
  description: 'Derives new knowledge from existing relations via logical inference rules.',
  triggers: [
    { type: 'chain', from: 'relate' },
    { type: 'tag_present', tag: 'relation' },
  ],

  run(input: DemonInput): DemonOutput {
    const write: Omit<MemSlot, 'id' | 'created_at'>[] = [];
    const actions: DemonOutput['actions'] = [];
    const chain: string[] = [];

    // Gather all relations from working memory
    const relSlots = findByTag(input.memory, 'relation');
    const contextSlots = findByTag(input.memory, 'context_fact');
    const hierarchySlots = findByTag(input.memory, 'hierarchy');

    const relations: RelContent[] = [
      ...relSlots.map((s) => s.content as RelContent),
      ...contextSlots.map((s) => s.content as RelContent),
    ];

    const hierarchies = hierarchySlots.map((s) => s.content as { noun: string; is_a: string });

    if (relations.length === 0) {
      return { write: [] as MemSlot[], evict: [], focus: [], actions: [], chain: ['question'] };
    }

    // Rule 1: Transitive inference
    const transitiveTypes = new Set(['is_a', 'causes', 'requires', 'part_of', 'precedes']);
    const transitive = inferTransitive(relations, transitiveTypes);
    for (const rel of transitive) {
      write.push({
        content: { ...rel, inferred: true, rule: 'transitivity' },
        tag: 'inferred_relation',
        confidence: rel.weight,
        source_demon: 'infer',
        ttl: 6,
      });
    }

    // Rule 2: Property inheritance
    const inherited = inferInheritance(relations);
    for (const rel of inherited) {
      write.push({
        content: { ...rel, inferred: true, rule: 'inheritance' },
        tag: 'inferred_relation',
        confidence: rel.weight,
        source_demon: 'infer',
        ttl: 6,
      });
    }

    // Rule 3: Contradiction detection
    const contradictions = detectContradictions(relations);
    for (const contradiction of contradictions) {
      write.push({
        content: contradiction,
        tag: 'contradiction',
        confidence: 0.9,
        source_demon: 'infer',
        ttl: 0, // Contradictions persist — they're important
      });
    }

    // Rule 4: Claim assessment (when student makes a claim)
    const intentSlot = latestByTag(input.memory, 'intent');
    if (intentSlot && String(intentSlot.content) === 'claim') {
      const assessment = assessClaim(relations, hierarchies);
      write.push({
        content: assessment,
        tag: 'claim_assessment',
        confidence: assessment.confidence,
        source_demon: 'infer',
        ttl: 0,
      });
    }

    // Decide what fires next
    if (contradictions.length > 0) {
      chain.push('question'); // Ask about contradictions
    }

    const totalInferred = transitive.length + inherited.length;
    if (totalInferred > 0) {
      chain.push('decompose'); // Break down the inferred knowledge further
    }

    chain.push('question'); // Always end with generating a response

    actions.push({
      type: 'log',
      message: `Infer: transitive=${transitive.length}, inherited=${inherited.length}, contradictions=${contradictions.length}`,
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

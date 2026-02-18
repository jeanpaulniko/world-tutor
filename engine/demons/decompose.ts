/**
 * Decompose Demon — Breaks complex concepts into simpler parts.
 *
 * When the student asks about something complex, or when they're
 * confused, this demon breaks it down into prerequisite steps,
 * component parts, or simpler explanations.
 *
 * Maps to RTSG Section 14: "Dimensional Nerve Complex" — decomposition
 * identifies which dimensions (intelligence facets) a concept spans
 * and finds the simplicial structure connecting them.
 */

import type { Demon, DemonOutput, DemonInput, MemSlot } from '../core/types.js';
import { findByTag, latestByTag } from '../memory/working-memory.js';
import { findNoun, relationsFrom, query } from '../store/knowledge-graph.js';

/** Break a concept into its graph-based components. */
function decomposeFromGraph(conceptLabel: string): {
  parts: Array<{ label: string; relation: string }>;
  prerequisites: string[];
  examples: string[];
} {
  const parts: Array<{ label: string; relation: string }> = [];
  const prerequisites: string[] = [];
  const examples: string[] = [];

  const noun = findNoun(conceptLabel);
  if (!noun) return { parts, prerequisites, examples };

  const rels = relationsFrom(noun.id);
  for (const rel of rels) {
    switch (rel.type) {
      case 'part_of':
      case 'has':
      case 'contains':
        parts.push({ label: rel.to.label, relation: rel.type });
        break;
      case 'requires':
        prerequisites.push(rel.to.label);
        break;
      case 'example_of':
        examples.push(rel.to.label);
        break;
    }
  }

  // Also look for things that are part_of this concept (reverse)
  const results = query({ to: { label: conceptLabel }, relation: 'part_of' });
  for (const r of results) {
    parts.push({ label: r.from.label, relation: 'component' });
  }

  // And things that are examples of this concept
  const exampleResults = query({ to: { label: conceptLabel }, relation: 'example_of' });
  for (const r of exampleResults) {
    examples.push(r.from.label);
  }

  return { parts, prerequisites, examples };
}

/** Simple heuristic decomposition when the graph doesn't have enough. */
function heuristicDecompose(concept: string, subject: string): {
  steps: string[];
  approach: string;
} {
  // Generic decomposition strategies based on subject
  const strategies: Record<string, { steps: string[]; approach: string }> = {
    mathematics: {
      steps: [
        'identify what is given (known values)',
        'identify what is asked for (unknown)',
        'determine which formula or method applies',
        'substitute known values',
        'solve step by step',
        'verify the answer makes sense',
      ],
      approach: 'mathematical_problem_solving',
    },
    physics: {
      steps: [
        'identify the physical system and forces involved',
        'draw a diagram or model',
        'list known quantities with units',
        'identify the relevant physical laws',
        'set up equations',
        'solve and check units',
      ],
      approach: 'physics_problem_solving',
    },
    biology: {
      steps: [
        'identify the biological system or process',
        'break into component structures',
        'understand the function of each component',
        'trace the flow of energy or information',
        'connect to larger systems',
      ],
      approach: 'biological_analysis',
    },
    history: {
      steps: [
        'identify the time period and region',
        'understand the context and preceding events',
        'identify the key actors and their motivations',
        'trace the sequence of events',
        'analyze the consequences and lasting effects',
      ],
      approach: 'historical_analysis',
    },
    language: {
      steps: [
        'identify the type of language task',
        'break down the sentence structure',
        'identify the parts of speech',
        'apply relevant grammar rules',
        'check for meaning and clarity',
      ],
      approach: 'language_analysis',
    },
    computer_science: {
      steps: [
        'understand the problem requirements',
        'identify input and expected output',
        'choose an approach or algorithm',
        'break into smaller sub-problems',
        'implement step by step',
        'test with examples',
      ],
      approach: 'computational_thinking',
    },
  };

  return strategies[subject] || {
    steps: [
      'identify the key components of the concept',
      'understand how the components relate to each other',
      'find a simpler analogy or example',
      'build understanding from the simplest part up',
    ],
    approach: 'general_decomposition',
  };
}

/** Determine which prerequisite knowledge the student might be missing. */
function identifyGaps(
  prerequisites: string[],
  knownConcepts: Set<string>,
): string[] {
  return prerequisites.filter((p) => !knownConcepts.has(p));
}

export const decomposeDemon: Demon = {
  id: 'decompose',
  name: 'Decompose',
  description: 'Breaks complex concepts into simpler parts, prerequisites, and steps.',
  triggers: [
    { type: 'chain', from: 'infer' },
    { type: 'chain', from: 'parse' },
    { type: 'tag_present', tag: 'confusion' },
  ],

  run(input: DemonInput): DemonOutput {
    const write: Omit<MemSlot, 'id' | 'created_at'>[] = [];
    const actions: DemonOutput['actions'] = [];
    const chain: string[] = [];

    // What are we decomposing?
    const focusSlot = latestByTag(input.memory, 'question_focus');
    const intentSlot = latestByTag(input.memory, 'intent');
    const subjectSlot = latestByTag(input.memory, 'subject');

    const concept = focusSlot ? String(focusSlot.content)
      : latestByTag(input.memory, 'noun_phrase')?.content as string || '';

    const subject = subjectSlot ? String(subjectSlot.content) : 'general';
    const intent = intentSlot ? String(intentSlot.content) : 'unknown';

    if (!concept) {
      return { write: [] as MemSlot[], evict: [], focus: [], actions: [], chain: ['question'] };
    }

    // Try graph-based decomposition first
    const graphDecomp = decomposeFromGraph(concept);

    // Always get heuristic decomposition as fallback
    const heuristic = heuristicDecompose(concept, subject);

    // Write the decomposition
    if (graphDecomp.parts.length > 0) {
      write.push({
        content: {
          concept,
          parts: graphDecomp.parts,
          source: 'knowledge_graph',
        },
        tag: 'decomposition',
        confidence: 0.8,
        source_demon: 'decompose',
        ttl: 0,
      });
    }

    if (graphDecomp.prerequisites.length > 0) {
      // Check which prerequisites might be gaps
      const knownConcepts = new Set<string>();
      for (const slot of input.memory.slots.values()) {
        if (slot.tag === 'noun_phrase' || slot.tag === 'hierarchy') {
          const content = slot.content;
          if (typeof content === 'string') knownConcepts.add(content.toLowerCase());
          if (typeof content === 'object' && content !== null && 'noun' in content) {
            knownConcepts.add(String((content as Record<string, unknown>).noun).toLowerCase());
          }
        }
      }

      const gaps = identifyGaps(graphDecomp.prerequisites, knownConcepts);

      write.push({
        content: {
          concept,
          prerequisites: graphDecomp.prerequisites,
          gaps,
        },
        tag: 'prerequisites',
        confidence: 0.7,
        source_demon: 'decompose',
        ttl: 0,
      });

      if (gaps.length > 0) {
        write.push({
          content: gaps,
          tag: 'knowledge_gaps',
          confidence: 0.8,
          source_demon: 'decompose',
          ttl: 0,
        });
      }
    }

    if (graphDecomp.examples.length > 0) {
      write.push({
        content: {
          concept,
          examples: graphDecomp.examples,
        },
        tag: 'examples',
        confidence: 0.7,
        source_demon: 'decompose',
        ttl: 8,
      });
    }

    // Write heuristic steps (always useful for problem-solving guidance)
    write.push({
      content: {
        concept,
        steps: heuristic.steps,
        approach: heuristic.approach,
        subject,
      },
      tag: 'solution_steps',
      confidence: 0.6,
      source_demon: 'decompose',
      ttl: 0,
    });

    // Student is confused — prioritize simplification
    if (intent === 'confusion') {
      write.push({
        content: {
          simplify: true,
          original_concept: concept,
          strategy: 'break_into_smallest_parts',
        },
        tag: 'simplification_needed',
        confidence: 0.9,
        source_demon: 'decompose',
        ttl: 0,
      });
      chain.push('analogize'); // Find a simpler analogy
    }

    chain.push('question'); // Generate the response

    actions.push({
      type: 'log',
      message: `Decompose: parts=${graphDecomp.parts.length}, prereqs=${graphDecomp.prerequisites.length}, examples=${graphDecomp.examples.length}`,
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

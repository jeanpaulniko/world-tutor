/**
 * Question Demon — Generates Socratic responses.
 *
 * This is the FINAL demon in most chains. It reads everything in
 * working memory — intent, relations, inferences, decompositions,
 * analogies, contradictions — and constructs a Socratic response.
 *
 * The Socratic method means: never give the answer directly.
 * Instead, ask a question that leads the student to discover it.
 *
 * Maps to RTSG Section 21: "Hypervisor (Consciousness Architecture)" —
 * the question demon is the conscious output channel that synthesizes
 * all unconscious processing into a coherent interaction.
 */

import type { Demon, DemonOutput, DemonInput, MemSlot } from '../core/types.js';
import { findByTag, latestByTag, getFocused } from '../memory/working-memory.js';

/** Build a Socratic response based on everything in working memory. */
function buildResponse(input: DemonInput): string {
  const intent = latestByTag(input.memory, 'intent');
  const subject = latestByTag(input.memory, 'subject');
  const focus = latestByTag(input.memory, 'question_focus');
  const relations = findByTag(input.memory, 'relation');
  const inferred = findByTag(input.memory, 'inferred_relation');
  const contradictions = findByTag(input.memory, 'contradiction');
  const decompositions = findByTag(input.memory, 'decomposition');
  const prerequisites = findByTag(input.memory, 'prerequisites');
  const knowledgeGaps = findByTag(input.memory, 'knowledge_gaps');
  const analogies = findByTag(input.memory, 'analogy');
  const examples = findByTag(input.memory, 'examples');
  const steps = findByTag(input.memory, 'solution_steps');
  const claimAssessment = latestByTag(input.memory, 'claim_assessment');
  const unknownConcepts = latestByTag(input.memory, 'unknown_concepts');
  const simplificationNeeded = latestByTag(input.memory, 'simplification_needed');

  const intentStr = intent ? String(intent.content) : 'unknown';
  const subjectStr = subject ? String(subject.content) : 'general';
  const focusStr = focus ? String(focus.content) : '';

  // ─── Greeting ───
  if (intentStr === 'greeting') {
    return buildGreetingResponse(subjectStr);
  }

  // ─── Contradiction Found — Challenge the student ───
  if (contradictions.length > 0) {
    return buildContradictionResponse(contradictions);
  }

  // ─── Student is confused — Simplify ───
  if (intentStr === 'confusion' || simplificationNeeded) {
    return buildConfusionResponse(focusStr, analogies, decompositions, steps);
  }

  // ─── Student made a claim — Assess and question ───
  if (intentStr === 'claim' && claimAssessment) {
    return buildClaimResponse(claimAssessment, relations, inferred);
  }

  // ─── Student asked a question — Guide to the answer ───
  if (intentStr === 'question' || intentStr === 'request') {
    return buildQuestionResponse(
      focusStr,
      subjectStr,
      relations,
      inferred,
      decompositions,
      prerequisites,
      knowledgeGaps,
      analogies,
      examples,
      steps,
      unknownConcepts,
    );
  }

  // ─── Correction — Acknowledge and redirect ───
  if (intentStr === 'correction') {
    return buildCorrectionResponse(focusStr, relations);
  }

  // ─── Fallback ───
  return buildFallbackResponse(focusStr, subjectStr);
}

function buildGreetingResponse(subject: string): string {
  const greetings = [
    "Hello! I'm here to help you learn. What would you like to explore today?",
    "Hi there! What topic are you curious about?",
    "Welcome! What would you like to understand better today?",
    "Hey! Ready to learn something new? What's on your mind?",
  ];

  if (subject !== 'general') {
    return `Hello! I see you're interested in ${subject}. What specifically would you like to explore?`;
  }

  return greetings[Math.floor(Math.random() * greetings.length)];
}

function buildContradictionResponse(contradictions: MemSlot[]): string {
  const first = contradictions[0].content as {
    concept: string;
    claim1: { from: string; to: string };
    claim2: { from: string; to: string };
    reason: string;
  };

  return `Hmm, I notice something interesting. You mentioned that "${first.claim1.from}" relates to both "${first.claim1.to}" and "${first.claim2.to}". But ${first.reason}. Can you think about which one is correct, and why?`;
}

function buildConfusionResponse(
  focus: string,
  analogies: MemSlot[],
  decompositions: MemSlot[],
  steps: MemSlot[],
): string {
  const parts: string[] = [];

  parts.push(`No worries — let's break this down step by step.`);

  // Use analogy if available
  if (analogies.length > 0) {
    const analogy = analogies[0].content as {
      concept: string;
      analog: string;
      explanation?: string;
    };
    if (analogy.explanation) {
      parts.push(`Think of it this way: ${analogy.explanation}`);
    } else {
      parts.push(`It might help to think of "${analogy.concept}" as similar to "${analogy.analog}".`);
    }
  }

  // Suggest the simplest starting point
  if (decompositions.length > 0) {
    const decomp = decompositions[0].content as {
      concept: string;
      parts: Array<{ label: string }>;
    };
    if (decomp.parts.length > 0) {
      parts.push(`Let's start with the simplest part: "${decomp.parts[0].label}". What do you already know about it?`);
    }
  } else if (focus) {
    parts.push(`Let's start from the very beginning. What do you already know about ${focus}?`);
  }

  return parts.join('\n\n');
}

function buildClaimResponse(
  assessment: MemSlot,
  relations: MemSlot[],
  inferred: MemSlot[],
): string {
  const claim = assessment.content as {
    supported: Array<{ from: string; type: string; to: string }>;
    unsupported: string[];
    confidence: number;
  };

  if (claim.confidence > 0.7 && claim.unsupported.length === 0) {
    // Good understanding — push further
    const followUp = inferred.length > 0
      ? `Now, if that's true, what does it tell us about ${(inferred[0].content as any).to}?`
      : `Good thinking! Can you explain *why* that is the case?`;
    return `That's on the right track! ${followUp}`;
  }

  if (claim.confidence < 0.3) {
    // Significant misunderstanding
    if (claim.unsupported.length > 0) {
      return `I'm not sure about that. Let's check: what exactly do you mean by "${claim.unsupported[0]}"? Can you explain it in your own words?`;
    }
    return `Let's slow down and think about this more carefully. What makes you think that? What evidence do you have?`;
  }

  // Partially correct — guide refinement
  if (claim.unsupported.length > 0) {
    return `You're partly right! But I'm curious about the part where you mention "${claim.unsupported[0]}". How does that connect to what we know?`;
  }

  return `Interesting! You're getting there. Can you think of a specific example that would support or challenge your idea?`;
}

function buildQuestionResponse(
  focus: string,
  subject: string,
  relations: MemSlot[],
  inferred: MemSlot[],
  decompositions: MemSlot[],
  prerequisites: MemSlot[],
  knowledgeGaps: MemSlot[],
  analogies: MemSlot[],
  examples: MemSlot[],
  steps: MemSlot[],
  unknownConcepts: MemSlot | undefined,
): string {
  const parts: string[] = [];

  // If there are knowledge gaps, address those first
  if (knowledgeGaps && knowledgeGaps.length > 0) {
    const gaps = knowledgeGaps[0].content as string[];
    if (gaps.length > 0) {
      parts.push(`Before we tackle "${focus}", let's make sure we have the foundation. What do you know about "${gaps[0]}"?`);
      return parts.join('\n\n');
    }
  }

  // If we don't know the concept at all
  if (unknownConcepts) {
    const unknown = unknownConcepts.content as string[];
    if (unknown.length > 0 && unknown.includes(focus)) {
      parts.push(`That's a great question! "${focus}" is something we can explore together.`);

      // Use analogy to introduce
      if (analogies.length > 0) {
        const analogy = analogies[0].content as { analog: string; explanation?: string };
        if (analogy.explanation) {
          parts.push(analogy.explanation);
        }
      }

      // Suggest decomposition approach
      if (steps.length > 0) {
        const s = steps[0].content as { steps: string[] };
        parts.push(`Let's start by ${s.steps[0]}. What can you tell me about that?`);
      } else {
        parts.push(`Let's start simple: have you encountered this idea before, even in a different context?`);
      }

      return parts.join('\n\n');
    }
  }

  // We have some knowledge — guide discovery
  if (relations.length > 0) {
    const rel = relations[0].content as { from: string; type: string; to: string };

    // Don't just state the answer — make the student discover it
    switch (rel.type) {
      case 'causes':
        parts.push(`Think about what happens when "${rel.from}" occurs. What do you think the effect would be?`);
        break;
      case 'is_a':
        parts.push(`"${rel.from}" is a type of something larger. Can you guess what category it belongs to?`);
        break;
      case 'has':
      case 'contains':
        parts.push(`"${rel.from}" is made up of different parts. What components do you think it has?`);
        break;
      case 'requires':
        parts.push(`To understand "${rel.from}", we need to first understand something else. What do you think that prerequisite might be?`);
        break;
      case 'opposes':
        parts.push(`"${rel.from}" has an opposite. What do you think that opposite is, and why?`);
        break;
      default:
        parts.push(`Let's think about how "${rel.from}" and "${rel.to}" are connected. What relationship do you see between them?`);
    }

    // Add a hint from decomposition if available
    if (decompositions.length > 0) {
      const decomp = decompositions[0].content as { parts: Array<{ label: string }> };
      if (decomp.parts.length > 1) {
        parts.push(`Hint: think about the different parts involved. There's ${decomp.parts.map(p => `"${p.label}"`).slice(0, 3).join(', ')}, among others.`);
      }
    }
  } else if (analogies.length > 0) {
    // No direct relations but we have analogies
    const analogy = analogies[0].content as { concept: string; analog: string; explanation?: string };
    if (analogy.explanation) {
      parts.push(analogy.explanation);
      parts.push(`With that analogy in mind, what would you guess about "${focus}"?`);
    }
  } else if (examples.length > 0) {
    const ex = examples[0].content as { examples: string[] };
    parts.push(`Let's think about some examples. Consider "${ex.examples[0]}". How does that relate to the bigger idea of "${focus}"?`);
  } else {
    // Completely unknown territory — explore together
    parts.push(`That's a really interesting question about "${focus}"!`);
    parts.push(`Let's think about it together. What's your intuition? Even a guess is a good starting point.`);
  }

  if (parts.length === 0) {
    return buildFallbackResponse(focus, subject);
  }

  return parts.join('\n\n');
}

function buildCorrectionResponse(focus: string, relations: MemSlot[]): string {
  return `I appreciate the correction! Let's reconsider. What specifically about "${focus}" did I get wrong? Help me understand your reasoning.`;
}

function buildFallbackResponse(focus: string, subject: string): string {
  if (focus) {
    return `Let's explore "${focus}" together. What aspect of it interests you most? What do you already know about it?`;
  }
  return `I'd love to help you learn! What topic or question would you like to explore?`;
}

export const questionDemon: Demon = {
  id: 'question',
  name: 'Question',
  description: 'Generates Socratic responses based on everything in working memory.',
  triggers: [
    { type: 'chain', from: 'infer' },
    { type: 'chain', from: 'decompose' },
    { type: 'chain', from: 'analogize' },
    { type: 'chain', from: 'relate' },
    { type: 'chain', from: 'parse' },
  ],

  run(input: DemonInput): DemonOutput {
    const response = buildResponse(input);

    // Store the response in working memory too (for conversation context)
    const write: Omit<MemSlot, 'id' | 'created_at'>[] = [
      {
        content: response,
        tag: 'response',
        confidence: 0.8,
        source_demon: 'question',
        ttl: 20, // Keep recent responses for context
      },
    ];

    return {
      write: write as MemSlot[],
      evict: [],
      focus: [],
      actions: [
        { type: 'respond', text: response },
      ],
      chain: [], // Terminal — no more demons to chain
    };
  },
};

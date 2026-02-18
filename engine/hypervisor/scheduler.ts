/**
 * Hypervisor — The consciousness architecture that orchestrates demons.
 *
 * The hypervisor is the scheduler/executive that decides which demons
 * run, in what order, and when to stop. It processes user input through
 * a chain of demons, collecting their outputs and feeding them back
 * in until a terminal response is produced or limits are hit.
 *
 * Maps directly to RTSG Section 21: "Hypervisor (Consciousness Architecture)"
 * — the hypervisor is the conscious executive that orchestrates the
 * unconscious processing (demons) and produces coherent output.
 *
 * Flow per user turn:
 *  1. Write raw input to working memory
 *  2. Fire 'new_input' triggered demons (→ parse)
 *  3. Process ONLY explicit chain suggestions (not tag triggers after first tick)
 *  4. Stop as soon as a 'respond' action is produced with no further chains
 *  5. Fire 'learn' demon once to persist knowledge
 *  6. Return the response
 */

import type {
  HypervisorConfig,
  TickResult,
  DemonAction,
  DemonOutput,
  MemSlot,
  WorkingMemory,
} from '../core/types.js';
import {
  createWorkingMemory,
  writeSlot,
  evictSlot,
  setFocus,
  tick as tickMemory,
  enforceLimit,
  findByTag,
} from '../memory/working-memory.js';
import { DEMONS, getDemon, getTriggeredDemons } from '../demons/index.js';
import { initGraph } from '../store/knowledge-graph.js';

const DEFAULT_CONFIG: HypervisorConfig = {
  maxTicksPerTurn: 20,    // Max reasoning cycles before forced response
  maxDemonsPerTick: 5,    // Max demons that can fire in one tick
  maxMemorySlots: 100,    // Max working memory slots
  tickTimeoutMs: 500,     // Max time per tick (half second)
};

export interface HypervisorState {
  memory: WorkingMemory;
  config: HypervisorConfig;
  history: TickResult[];
  initialized: boolean;
}

/** Create a new hypervisor state. */
export function createHypervisor(config?: Partial<HypervisorConfig>): HypervisorState {
  return {
    memory: createWorkingMemory(),
    config: { ...DEFAULT_CONFIG, ...config },
    history: [],
    initialized: false,
  };
}

/** Initialize the hypervisor (ensures knowledge graph is ready). */
export function initHypervisor(state: HypervisorState): void {
  if (!state.initialized) {
    initGraph();
    state.initialized = true;
  }
}

/** Apply a demon's output to working memory. */
function applyDemonOutput(
  memory: WorkingMemory,
  output: DemonOutput,
  maxSlots: number,
): { slotsWritten: string[]; slotsEvicted: string[] } {
  const slotsWritten: string[] = [];
  const slotsEvicted: string[] = [];

  // Write new slots
  for (const slotData of output.write) {
    const slot = writeSlot(memory, slotData);
    slotsWritten.push(slot.id);
  }

  // Evict requested slots
  for (const id of output.evict) {
    if (evictSlot(memory, id)) {
      slotsEvicted.push(id);
    }
  }

  // Update focus if requested
  if (output.focus.length > 0) {
    setFocus(memory, output.focus);
  }

  // Enforce memory limits
  const overflowEvicted = enforceLimit(memory, maxSlots);
  slotsEvicted.push(...overflowEvicted);

  return { slotsWritten, slotsEvicted };
}

/** Process a user message through the full demon pipeline. Returns the response text. */
export function processInput(state: HypervisorState, userInput: string): {
  response: string;
  ticks: TickResult[];
  actions: DemonAction[];
} {
  // Ensure initialized
  initHypervisor(state);

  // Step 1: Write raw input to working memory
  writeSlot(state.memory, {
    content: userInput,
    tag: 'raw_input',
    confidence: 1.0,
    source_demon: 'user',
    ttl: 0,
  });

  // Step 2: Build the execution chain. We use a CHAIN-ONLY model:
  // Only explicitly chained demons fire. Tag triggers are only checked
  // on the first tick to seed the initial chain.
  const ticks: TickResult[] = [];
  const allActions: DemonAction[] = [];
  let response = '';

  // The queue of demons to fire next (ordered)
  let pendingDemons: string[] = [];

  // Seed with new_input triggered demons (just 'parse')
  const newInputDemons = getTriggeredDemons({ type: 'new_input' });
  for (const demon of newInputDemons) {
    pendingDemons.push(demon.id);
  }

  // Step 3: Run ticks — each tick fires the pending demons and collects chains
  for (let i = 0; i < state.config.maxTicksPerTurn; i++) {
    if (pendingDemons.length === 0) break; // Nothing to do

    const startTime = Date.now();
    const tick = state.memory.tick;
    const demonsFired: string[] = [];
    const allSlotsWritten: string[] = [];
    const allSlotsEvicted: string[] = [];
    const tickActions: DemonAction[] = [];
    const nextDemons: string[] = []; // Chain suggestions for next tick
    const firedThisTick = new Set<string>(); // Prevent firing same demon twice per tick

    // Fire each pending demon (limited by config)
    const toFire = pendingDemons.slice(0, state.config.maxDemonsPerTick);
    pendingDemons = pendingDemons.slice(state.config.maxDemonsPerTick);

    for (const demonId of toFire) {
      if (firedThisTick.has(demonId)) continue; // Already fired this tick
      firedThisTick.add(demonId);

      const demon = getDemon(demonId);
      if (!demon) continue;

      // Check timeout
      if (Date.now() - startTime > state.config.tickTimeoutMs) {
        tickActions.push({ type: 'log', message: `Tick ${tick}: timeout` });
        break;
      }

      try {
        const output = demon.run({
          memory: state.memory,
          context: findByTag(state.memory, 'subject')[0]?.content as string,
        });

        demonsFired.push(demonId);

        // Apply output to working memory
        const { slotsWritten, slotsEvicted } = applyDemonOutput(
          state.memory,
          output,
          state.config.maxMemorySlots,
        );

        allSlotsWritten.push(...slotsWritten);
        allSlotsEvicted.push(...slotsEvicted);
        tickActions.push(...output.actions);

        // Check if this demon produced a response
        for (const action of output.actions) {
          if (action.type === 'respond') {
            response = action.text;
          }
        }

        // Collect chain suggestions — but ONLY if no response yet,
        // or if the chains are NEW (not already in the queue)
        if (!response) {
          for (const chainId of output.chain) {
            if (!firedThisTick.has(chainId)) {
              nextDemons.push(chainId);
            }
          }
        }
        // If we got a response and chain is empty, this is terminal
        if (response && output.chain.length === 0) {
          // Terminal — clear everything
          nextDemons.length = 0;
          pendingDemons.length = 0;
          break;
        }
      } catch (err) {
        tickActions.push({
          type: 'log',
          message: `Demon "${demonId}" threw: ${(err as Error).message}`,
        });
      }
    }

    // Advance working memory clock
    const decayEvicted = tickMemory(state.memory);
    allSlotsEvicted.push(...decayEvicted);

    const tickResult: TickResult = {
      tick,
      demons_fired: demonsFired,
      slots_written: allSlotsWritten,
      slots_evicted: allSlotsEvicted,
      actions: tickActions,
      duration_ms: Date.now() - startTime,
    };

    ticks.push(tickResult);
    allActions.push(...tickActions);
    state.history.push(tickResult);

    // Set up next tick's demons from chain suggestions
    // Deduplicate: don't re-add demons already pending
    const pendingSet = new Set(pendingDemons);
    for (const id of nextDemons) {
      if (!pendingSet.has(id)) {
        pendingDemons.push(id);
        pendingSet.add(id);
      }
    }

    // If we have a response and no more demons pending, we're done
    if (response && pendingDemons.length === 0) {
      break;
    }
  }

  // Step 4: Fire the learn demon ONCE to persist knowledge
  const learnDemon = getDemon('learn');
  if (learnDemon) {
    try {
      const learnOutput = learnDemon.run({
        memory: state.memory,
        context: findByTag(state.memory, 'subject')[0]?.content as string,
      });
      applyDemonOutput(state.memory, learnOutput, state.config.maxMemorySlots);
      allActions.push(...learnOutput.actions);
    } catch {
      // Non-critical
    }
  }

  // Step 5: Clean up turn-specific slots
  const tagsToEvict = ['raw_input', 'intent', 'noun_phrase', 'question_focus',
    'relation', 'context_fact', 'hierarchy', 'inferred_relation',
    'contradiction', 'claim_assessment', 'unknown_concepts',
    'decomposition', 'prerequisites', 'knowledge_gaps', 'examples',
    'solution_steps', 'simplification_needed', 'analogy', 'fuzzy_match'];

  for (const tag of tagsToEvict) {
    const slots = findByTag(state.memory, tag);
    for (const slot of slots) {
      evictSlot(state.memory, slot.id);
    }
  }

  // Fallback response
  if (!response) {
    response = "I'd love to help you learn! What topic would you like to explore?";
  }

  return { response, ticks, actions: allActions };
}

/** Get stats about the current hypervisor state. */
export function hypervisorStats(state: HypervisorState): {
  memorySlots: number;
  focusedSlots: number;
  totalTicks: number;
  totalDemonsFired: number;
  demonsRegistered: number;
} {
  return {
    memorySlots: state.memory.slots.size,
    focusedSlots: state.memory.focus.length,
    totalTicks: state.memory.tick,
    totalDemonsFired: state.history.reduce((sum, t) => sum + t.demons_fired.length, 0),
    demonsRegistered: DEMONS.size,
  };
}

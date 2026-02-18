/**
 * Intelligence Engine — The public API.
 *
 * This is the single entry point to the entire intelligence engine.
 * Import this, create an engine, and call process() with user input.
 *
 * No LLM required. No external API calls. Pure algorithmic reasoning
 * running in RAM with SQLite-backed persistent knowledge.
 *
 * Architecture:
 *   Working Memory (RAM) ← Demons (pure functions) → Knowledge Graph (SQLite)
 *                              ↑
 *                         Hypervisor (scheduler)
 *                              ↑
 *                         Engine API (this file)
 */

import {
  createHypervisor,
  initHypervisor,
  processInput,
  hypervisorStats,
  type HypervisorState,
} from './hypervisor/scheduler.js';
import type { HypervisorConfig, TickResult, DemonAction } from './core/types.js';
import { graphStats } from './store/knowledge-graph.js';
import { serialize, deserialize } from './memory/working-memory.js';
import { DEMONS } from './demons/index.js';

export interface EngineConfig {
  hypervisor?: Partial<HypervisorConfig>;
}

export interface EngineResponse {
  text: string;
  debug?: {
    ticks: number;
    demonsFired: string[];
    actions: DemonAction[];
    duration_ms: number;
  };
}

export interface EngineStats {
  memory: {
    slots: number;
    focused: number;
    totalTicks: number;
  };
  graph: {
    nouns: number;
    relations: number;
    relationTypes: Record<string, number>;
  };
  demons: {
    registered: number;
    totalFired: number;
  };
}

/** The Intelligence Engine. */
export class Engine {
  private state: HypervisorState;
  private debug: boolean;

  constructor(config?: EngineConfig & { debug?: boolean }) {
    this.state = createHypervisor(config?.hypervisor);
    this.debug = config?.debug ?? false;
  }

  /** Initialize the engine (creates DB, etc.) */
  init(): void {
    initHypervisor(this.state);
  }

  /** Process user input and return a Socratic response. */
  process(input: string): EngineResponse {
    const startTime = Date.now();
    const { response, ticks, actions } = processInput(this.state, input);

    const result: EngineResponse = {
      text: response,
    };

    if (this.debug) {
      const allDemonsFired = ticks.flatMap((t) => t.demons_fired);
      result.debug = {
        ticks: ticks.length,
        demonsFired: allDemonsFired,
        actions,
        duration_ms: Date.now() - startTime,
      };
    }

    return result;
  }

  /** Get engine statistics. */
  stats(): EngineStats {
    const hvStats = hypervisorStats(this.state);
    const gStats = graphStats();

    return {
      memory: {
        slots: hvStats.memorySlots,
        focused: hvStats.focusedSlots,
        totalTicks: hvStats.totalTicks,
      },
      graph: {
        nouns: gStats.nouns,
        relations: gStats.relations,
        relationTypes: gStats.types,
      },
      demons: {
        registered: hvStats.demonsRegistered,
        totalFired: hvStats.totalDemonsFired,
      },
    };
  }

  /** Serialize engine state for persistence/recovery. */
  saveState(): string {
    return serialize(this.state.memory);
  }

  /** Restore engine state from serialized data. */
  loadState(data: string): void {
    this.state.memory = deserialize(data);
  }

  /** List all registered demons. */
  listDemons(): Array<{ id: string; name: string; description: string }> {
    return [...DEMONS.values()].map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
    }));
  }
}

/** Create and initialize an engine instance. */
export function createEngine(config?: EngineConfig & { debug?: boolean }): Engine {
  const engine = new Engine(config);
  engine.init();
  return engine;
}

// Re-export types
export type { HypervisorConfig, TickResult, DemonAction } from './core/types.js';

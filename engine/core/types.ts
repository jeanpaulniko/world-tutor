/**
 * Core types for the Intelligence Engine.
 *
 * The engine is a collection of small algorithm daemons ("seed demons")
 * running in RAM. Each is a pure function. They feed outputs to each other.
 * A hypervisor orchestrates them. Working memory holds intermediate state.
 */

// ─── Noun-Relation Store (Knowledge Graph) ───

/** A node in the knowledge graph. Everything is a noun. */
export interface Noun {
  id: string;
  label: string;           // Human-readable: "gravity", "cell", "x"
  type: NounType;
  properties: Record<string, unknown>;
  created_at: number;
}

export type NounType =
  | 'concept'      // Abstract: "gravity", "democracy", "addition"
  | 'entity'       // Concrete: "Earth", "Newton", "the number 5"
  | 'process'      // Action/verb nominalized: "falling", "dividing", "photosynthesis"
  | 'property'     // Attribute: "mass", "color", "speed"
  | 'value'        // Specific value: "9.8 m/s²", "blue", "42"
  | 'context'      // Framing: "physics", "algebra", "history"
  | 'unknown';     // Not yet classified

/** A directed relation between two nouns. */
export interface Relation {
  id: string;
  from_id: string;         // Source noun
  to_id: string;           // Target noun
  type: RelationType;
  weight: number;          // 0-1, confidence/strength
  context_id?: string;     // Optional: which context this relation lives in
  properties: Record<string, unknown>;
  created_at: number;
}

export type RelationType =
  | 'is_a'          // "dog" is_a "animal"
  | 'has'           // "cell" has "nucleus"
  | 'causes'        // "heat" causes "expansion"
  | 'part_of'       // "wheel" part_of "car"
  | 'used_for'      // "hammer" used_for "nailing"
  | 'opposes'       // "hot" opposes "cold"
  | 'requires'      // "division" requires "non-zero divisor"
  | 'produces'      // "photosynthesis" produces "oxygen"
  | 'equals'        // "x" equals "5"
  | 'greater_than'  // "10" greater_than "5"
  | 'less_than'
  | 'contains'      // "set A" contains "element x"
  | 'precedes'      // "WW1" precedes "WW2"
  | 'follows'       // "WW2" follows "WW1"
  | 'relates_to'    // Generic/weak relation
  | 'example_of'    // "apple" example_of "fruit"
  | 'defined_as';   // "velocity" defined_as "distance/time"

// ─── Working Memory ───

/** A slot in working memory. Holds an active concept being reasoned about. */
export interface MemSlot {
  id: string;
  noun_id?: string;        // Optional link to knowledge graph
  content: unknown;        // The actual data being worked on
  tag: string;             // What this slot represents: "student_claim", "current_step", etc.
  confidence: number;      // 0-1, how sure are we about this
  source_demon: string;    // Which demon produced this
  ttl: number;             // Ticks until eviction (0 = permanent for this session)
  created_at: number;
}

/** The full working memory state at any moment. */
export interface WorkingMemory {
  slots: Map<string, MemSlot>;
  focus: string[];         // Ordered list of slot IDs currently in focus
  tick: number;            // Global clock tick
}

// ─── Seed Demons ───

/** Input to a demon: the current working memory + optional trigger data. */
export interface DemonInput {
  memory: WorkingMemory;
  trigger?: unknown;       // Optional: specific data that triggered this demon
  context?: string;        // Current subject/context
}

/** Output from a demon: memory mutations + optional actions. */
export interface DemonOutput {
  /** Slots to add or update in working memory. */
  write: MemSlot[];
  /** Slot IDs to remove from working memory. */
  evict: string[];
  /** Slot IDs to bring into focus. */
  focus: string[];
  /** Actions for the hypervisor to take. */
  actions: DemonAction[];
  /** Which demons should run next (suggestions to hypervisor). */
  chain: string[];
}

export type DemonAction =
  | { type: 'respond'; text: string }           // Send text to the user
  | { type: 'ask'; question: string }           // Ask the user a Socratic question
  | { type: 'store'; noun: Partial<Noun>; relations: Partial<Relation>[] }  // Persist to knowledge graph
  | { type: 'query'; pattern: QueryPattern }    // Query the knowledge graph
  | { type: 'log'; message: string };           // Debug log

/** A pattern for querying the noun-relation store. */
export interface QueryPattern {
  from?: Partial<Noun>;
  relation?: RelationType;
  to?: Partial<Noun>;
  depth?: number;          // How many hops to traverse
}

/** A seed demon: a pure function from input to output. */
export interface Demon {
  id: string;
  name: string;
  description: string;
  /** When should this demon fire? Evaluated by the hypervisor. */
  triggers: DemonTrigger[];
  /** The actual logic. Pure function. */
  run: (input: DemonInput) => DemonOutput;
}

export type DemonTrigger =
  | { type: 'always' }                          // Run every tick
  | { type: 'tag_present'; tag: string }        // Run when a slot with this tag exists
  | { type: 'tag_absent'; tag: string }         // Run when no slot with this tag
  | { type: 'chain'; from: string }             // Run when another demon chains to this
  | { type: 'new_input' }                       // Run when user sends new input
  | { type: 'tick_interval'; every: number };   // Run every N ticks

// ─── Hypervisor ───

/** Configuration for the hypervisor. */
export interface HypervisorConfig {
  maxTicksPerTurn: number;   // Max reasoning cycles per user input (prevent infinite loops)
  maxDemonsPerTick: number;  // Max demons to fire per tick
  maxMemorySlots: number;    // Max working memory slots before eviction
  tickTimeoutMs: number;     // Max time per tick
}

/** A record of what happened in one tick. */
export interface TickResult {
  tick: number;
  demons_fired: string[];
  slots_written: string[];
  slots_evicted: string[];
  actions: DemonAction[];
  duration_ms: number;
}

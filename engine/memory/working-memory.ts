/**
 * Working Memory — The RAM scratchpad where demons combine concepts.
 *
 * In-memory Map for speed. Can optionally persist snapshots to
 * DragonflyDB (Redis-compatible) for session recovery.
 */

import { nanoid } from 'nanoid';
import type { MemSlot, WorkingMemory } from '../core/types.js';

export function createWorkingMemory(): WorkingMemory {
  return {
    slots: new Map(),
    focus: [],
    tick: 0,
  };
}

/** Write a slot into working memory. Overwrites if same ID exists. */
export function writeSlot(mem: WorkingMemory, slot: Omit<MemSlot, 'id' | 'created_at'> & { id?: string }): MemSlot {
  const full: MemSlot = {
    id: slot.id || nanoid(8),
    noun_id: slot.noun_id,
    content: slot.content,
    tag: slot.tag,
    confidence: slot.confidence,
    source_demon: slot.source_demon,
    ttl: slot.ttl,
    created_at: Date.now(),
  };
  mem.slots.set(full.id, full);
  return full;
}

/** Read a slot by ID. */
export function readSlot(mem: WorkingMemory, id: string): MemSlot | undefined {
  return mem.slots.get(id);
}

/** Find all slots matching a tag. */
export function findByTag(mem: WorkingMemory, tag: string): MemSlot[] {
  const results: MemSlot[] = [];
  for (const slot of mem.slots.values()) {
    if (slot.tag === tag) results.push(slot);
  }
  return results;
}

/** Find the most recent slot with a given tag. */
export function latestByTag(mem: WorkingMemory, tag: string): MemSlot | undefined {
  let latest: MemSlot | undefined;
  for (const slot of mem.slots.values()) {
    if (slot.tag === tag) {
      if (!latest || slot.created_at > latest.created_at) {
        latest = slot;
      }
    }
  }
  return latest;
}

/** Evict a slot by ID. */
export function evictSlot(mem: WorkingMemory, id: string): boolean {
  mem.focus = mem.focus.filter((f) => f !== id);
  return mem.slots.delete(id);
}

/** Set which slots are in focus (ordered by importance). */
export function setFocus(mem: WorkingMemory, slotIds: string[]): void {
  mem.focus = slotIds.filter((id) => mem.slots.has(id));
}

/** Get the slots currently in focus. */
export function getFocused(mem: WorkingMemory): MemSlot[] {
  return mem.focus
    .map((id) => mem.slots.get(id))
    .filter((s): s is MemSlot => s !== undefined);
}

/** Advance the tick counter and decay TTLs. Evicts expired slots. */
export function tick(mem: WorkingMemory): string[] {
  mem.tick++;
  const evicted: string[] = [];

  for (const [id, slot] of mem.slots.entries()) {
    if (slot.ttl > 0) {
      slot.ttl--;
      if (slot.ttl <= 0) {
        mem.slots.delete(id);
        evicted.push(id);
      }
    }
  }

  // Remove evicted from focus
  if (evicted.length > 0) {
    mem.focus = mem.focus.filter((id) => !evicted.includes(id));
  }

  return evicted;
}

/** Enforce max slots by evicting oldest, lowest-confidence, unfocused slots. */
export function enforceLimit(mem: WorkingMemory, maxSlots: number): string[] {
  if (mem.slots.size <= maxSlots) return [];

  const evicted: string[] = [];
  const focusSet = new Set(mem.focus);

  // Sort slots: unfocused first, then by confidence (low first), then by age (old first)
  const sorted = [...mem.slots.entries()]
    .sort(([aId, a], [bId, b]) => {
      const aFocused = focusSet.has(aId) ? 1 : 0;
      const bFocused = focusSet.has(bId) ? 1 : 0;
      if (aFocused !== bFocused) return aFocused - bFocused; // Unfocused first
      if (a.confidence !== b.confidence) return a.confidence - b.confidence; // Low confidence first
      return a.created_at - b.created_at; // Oldest first
    });

  while (mem.slots.size > maxSlots && sorted.length > 0) {
    const [id] = sorted.shift()!;
    mem.slots.delete(id);
    evicted.push(id);
  }

  mem.focus = mem.focus.filter((id) => !evicted.includes(id));
  return evicted;
}

/** Serialize working memory to JSON for persistence/debug. */
export function serialize(mem: WorkingMemory): string {
  return JSON.stringify({
    slots: Object.fromEntries(mem.slots),
    focus: mem.focus,
    tick: mem.tick,
  });
}

/** Restore working memory from serialized JSON. */
export function deserialize(json: string): WorkingMemory {
  const data = JSON.parse(json);
  return {
    slots: new Map(Object.entries(data.slots)),
    focus: data.focus,
    tick: data.tick,
  };
}

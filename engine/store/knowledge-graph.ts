/**
 * Noun-Relation Store — The persistent knowledge graph.
 *
 * Uses SQLite for now (embedded, zero cost, runs everywhere).
 * Schema is designed so it can migrate to PostgreSQL when needed
 * (just change the driver — same SQL).
 *
 * Everything is nouns linked by relations. That's it.
 */

import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Noun, NounType, Relation, RelationType, QueryPattern } from '../core/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.GRAPH_DB_PATH || path.join(__dirname, '../../data/knowledge.db');

let db: Database.Database;

export function initGraph(): void {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS nouns (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'unknown',
      properties TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_nouns_label ON nouns(label);
    CREATE INDEX IF NOT EXISTS idx_nouns_type ON nouns(type);

    CREATE TABLE IF NOT EXISTS relations (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL REFERENCES nouns(id) ON DELETE CASCADE,
      to_id TEXT NOT NULL REFERENCES nouns(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      context_id TEXT REFERENCES nouns(id),
      properties TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_id);
    CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_id);
    CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(type);
    CREATE INDEX IF NOT EXISTS idx_relations_context ON relations(context_id);
    CREATE INDEX IF NOT EXISTS idx_relations_from_type ON relations(from_id, type);
    CREATE INDEX IF NOT EXISTS idx_relations_to_type ON relations(to_id, type);
  `);

  console.log('Knowledge graph initialized at', DB_PATH);
}

function getDb(): Database.Database {
  if (!db) initGraph();
  return db;
}

// ─── Noun Operations ───

export function createNoun(label: string, type: NounType = 'unknown', properties: Record<string, unknown> = {}): Noun {
  const noun: Noun = {
    id: nanoid(8),
    label: label.toLowerCase().trim(),
    type,
    properties,
    created_at: Date.now(),
  };

  getDb().prepare(
    'INSERT INTO nouns (id, label, type, properties, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(noun.id, noun.label, noun.type, JSON.stringify(noun.properties), noun.created_at);

  return noun;
}

export function findNoun(label: string): Noun | undefined {
  const row = getDb().prepare('SELECT * FROM nouns WHERE label = ?').get(label.toLowerCase().trim()) as any;
  return row ? { ...row, properties: JSON.parse(row.properties) } : undefined;
}

export function findNounById(id: string): Noun | undefined {
  const row = getDb().prepare('SELECT * FROM nouns WHERE id = ?').get(id) as any;
  return row ? { ...row, properties: JSON.parse(row.properties) } : undefined;
}

export function searchNouns(query: string, limit: number = 20): Noun[] {
  const rows = getDb().prepare(
    'SELECT * FROM nouns WHERE label LIKE ? ORDER BY created_at DESC LIMIT ?'
  ).all(`%${query.toLowerCase().trim()}%`, limit) as any[];
  return rows.map((r) => ({ ...r, properties: JSON.parse(r.properties) }));
}

/** Get or create a noun. Returns existing if label matches. */
export function ensureNoun(label: string, type: NounType = 'unknown', properties: Record<string, unknown> = {}): Noun {
  const existing = findNoun(label);
  if (existing) return existing;
  return createNoun(label, type, properties);
}

// ─── Relation Operations ───

export function createRelation(
  fromId: string,
  toId: string,
  type: RelationType,
  weight: number = 1.0,
  contextId?: string,
  properties: Record<string, unknown> = {}
): Relation {
  const rel: Relation = {
    id: nanoid(8),
    from_id: fromId,
    to_id: toId,
    type,
    weight,
    context_id: contextId,
    properties,
    created_at: Date.now(),
  };

  getDb().prepare(
    'INSERT INTO relations (id, from_id, to_id, type, weight, context_id, properties, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(rel.id, rel.from_id, rel.to_id, rel.type, rel.weight, rel.context_id || null, JSON.stringify(rel.properties), rel.created_at);

  return rel;
}

/** Link two nouns by label. Creates nouns if they don't exist. */
export function link(
  fromLabel: string,
  relType: RelationType,
  toLabel: string,
  weight: number = 1.0,
  contextLabel?: string
): { from: Noun; to: Noun; relation: Relation } {
  const from = ensureNoun(fromLabel);
  const to = ensureNoun(toLabel);
  const context = contextLabel ? ensureNoun(contextLabel, 'context') : undefined;
  const relation = createRelation(from.id, to.id, relType, weight, context?.id);
  return { from, to, relation };
}

/** Get all relations FROM a noun. */
export function relationsFrom(nounId: string, type?: RelationType): Array<Relation & { to: Noun }> {
  const sql = type
    ? 'SELECT r.*, n.label as to_label, n.type as to_type, n.properties as to_props FROM relations r JOIN nouns n ON r.to_id = n.id WHERE r.from_id = ? AND r.type = ?'
    : 'SELECT r.*, n.label as to_label, n.type as to_type, n.properties as to_props FROM relations r JOIN nouns n ON r.to_id = n.id WHERE r.from_id = ?';

  const args = type ? [nounId, type] : [nounId];
  const rows = getDb().prepare(sql).all(...args) as any[];

  return rows.map((r) => ({
    id: r.id,
    from_id: r.from_id,
    to_id: r.to_id,
    type: r.type,
    weight: r.weight,
    context_id: r.context_id,
    properties: JSON.parse(r.properties),
    created_at: r.created_at,
    to: { id: r.to_id, label: r.to_label, type: r.to_type, properties: JSON.parse(r.to_props), created_at: r.created_at },
  }));
}

/** Get all relations TO a noun. */
export function relationsTo(nounId: string, type?: RelationType): Array<Relation & { from: Noun }> {
  const sql = type
    ? 'SELECT r.*, n.label as from_label, n.type as from_type, n.properties as from_props FROM relations r JOIN nouns n ON r.from_id = n.id WHERE r.to_id = ? AND r.type = ?'
    : 'SELECT r.*, n.label as from_label, n.type as from_type, n.properties as from_props FROM relations r JOIN nouns n ON r.from_id = n.id WHERE r.to_id = ?';

  const args = type ? [nounId, type] : [nounId];
  const rows = getDb().prepare(sql).all(...args) as any[];

  return rows.map((r) => ({
    id: r.id,
    from_id: r.from_id,
    to_id: r.to_id,
    type: r.type,
    weight: r.weight,
    context_id: r.context_id,
    properties: JSON.parse(r.properties),
    created_at: r.created_at,
    from: { id: r.from_id, label: r.from_label, type: r.from_type, properties: JSON.parse(r.from_props), created_at: r.created_at },
  }));
}

/** Query the graph with a pattern. Returns matching relation paths. */
export function query(pattern: QueryPattern): Array<{ from: Noun; relation: Relation; to: Noun }> {
  let sql = `
    SELECT r.*,
      fn.label as from_label, fn.type as from_type, fn.properties as from_props,
      tn.label as to_label, tn.type as to_type, tn.properties as to_props
    FROM relations r
    JOIN nouns fn ON r.from_id = fn.id
    JOIN nouns tn ON r.to_id = tn.id
    WHERE 1=1
  `;
  const args: unknown[] = [];

  if (pattern.from?.label) {
    sql += ' AND fn.label = ?';
    args.push(pattern.from.label.toLowerCase().trim());
  }
  if (pattern.from?.type) {
    sql += ' AND fn.type = ?';
    args.push(pattern.from.type);
  }
  if (pattern.relation) {
    sql += ' AND r.type = ?';
    args.push(pattern.relation);
  }
  if (pattern.to?.label) {
    sql += ' AND tn.label = ?';
    args.push(pattern.to.label.toLowerCase().trim());
  }
  if (pattern.to?.type) {
    sql += ' AND tn.type = ?';
    args.push(pattern.to.type);
  }

  sql += ' ORDER BY r.weight DESC LIMIT 100';

  const rows = getDb().prepare(sql).all(...args) as any[];

  return rows.map((r) => ({
    from: { id: r.from_id, label: r.from_label, type: r.from_type, properties: JSON.parse(r.from_props), created_at: r.created_at },
    relation: { id: r.id, from_id: r.from_id, to_id: r.to_id, type: r.type, weight: r.weight, context_id: r.context_id, properties: JSON.parse(r.properties), created_at: r.created_at },
    to: { id: r.to_id, label: r.to_label, type: r.to_type, properties: JSON.parse(r.to_props), created_at: r.created_at },
  }));
}

/** Traverse the graph N hops from a starting noun. BFS. */
export function traverse(startId: string, maxDepth: number = 2): Map<string, { noun: Noun; depth: number; path: Relation[] }> {
  const visited = new Map<string, { noun: Noun; depth: number; path: Relation[] }>();
  const queue: Array<{ id: string; depth: number; path: Relation[] }> = [{ id: startId, depth: 0, path: [] }];

  const startNoun = findNounById(startId);
  if (startNoun) {
    visited.set(startId, { noun: startNoun, depth: 0, path: [] });
  }

  while (queue.length > 0) {
    const { id, depth, path } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const rels = relationsFrom(id);
    for (const rel of rels) {
      if (!visited.has(rel.to_id)) {
        visited.set(rel.to_id, { noun: rel.to, depth: depth + 1, path: [...path, rel] });
        queue.push({ id: rel.to_id, depth: depth + 1, path: [...path, rel] });
      }
    }
  }

  return visited;
}

/** Get stats about the knowledge graph. */
export function graphStats(): { nouns: number; relations: number; types: Record<string, number> } {
  const nouns = (getDb().prepare('SELECT COUNT(*) as c FROM nouns').get() as any).c;
  const relations = (getDb().prepare('SELECT COUNT(*) as c FROM relations').get() as any).c;
  const typeRows = getDb().prepare('SELECT type, COUNT(*) as c FROM relations GROUP BY type').all() as any[];
  const types: Record<string, number> = {};
  for (const r of typeRows) types[r.type] = r.c;
  return { nouns, relations, types };
}

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/tutor.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    initDb();
  }
  return db;
}

export function initDb(): void {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      language TEXT DEFAULT 'en',
      subject TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, created_at);
  `);

  console.log('Database initialized at', DB_PATH);
}

// Conversation operations
export function createConversation(id: string, language: string = 'en'): void {
  const stmt = getDb().prepare(
    'INSERT INTO conversations (id, language) VALUES (?, ?)'
  );
  stmt.run(id, language);
}

export function getConversation(id: string) {
  return getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id);
}

export function listConversations(limit: number = 50) {
  return getDb().prepare(
    'SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?'
  ).all(limit);
}

export function deleteConversation(id: string): void {
  getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id);
}

export function updateConversation(id: string, updates: { title?: string; subject?: string; language?: string }): void {
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const values: unknown[] = [];

  if (updates.title !== undefined) { sets.push('title = ?'); values.push(updates.title); }
  if (updates.subject !== undefined) { sets.push('subject = ?'); values.push(updates.subject); }
  if (updates.language !== undefined) { sets.push('language = ?'); values.push(updates.language); }

  values.push(id);
  getDb().prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

// Message operations
export function addMessage(id: string, conversationId: string, role: string, content: string): void {
  getDb().prepare(
    'INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)'
  ).run(id, conversationId, role, content);

  getDb().prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversationId);
}

export function getMessages(conversationId: string, limit: number = 20) {
  return getDb().prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?'
  ).all(conversationId, limit);
}

export function getRecentMessages(conversationId: string, limit: number = 10) {
  // Get last N messages for context window
  const rows = getDb().prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(conversationId, limit);
  return (rows as Array<{ role: string; content: string }>).reverse();
}

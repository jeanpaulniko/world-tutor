/**
 * Engine-powered Chat Route — Uses the Intelligence Engine instead of an LLM.
 *
 * This is the replacement for the LLM-based chat route. Instead of sending
 * messages to Groq/OpenAI, it processes them through our own intelligence
 * engine: a collection of seed demons running in RAM with a SQLite-backed
 * knowledge graph.
 *
 * Zero API cost. Zero latency from network calls. Pure local reasoning.
 */

import { Router, Request, Response } from 'express';
import { nanoid } from 'nanoid';
import { createEngine, type Engine } from '../../engine/index.js';
import { generateTitle } from '../lib/socratic.js';
import {
  createConversation,
  getConversation,
  listConversations,
  deleteConversation,
  updateConversation,
  addMessage,
  getMessages,
  getRecentMessages,
} from '../lib/db.js';

export const engineChatRouter = Router();

// Single engine instance shared across all requests.
// Working memory is per-conversation in the future; for now it's global.
let engine: Engine | null = null;

function getEngine(): Engine {
  if (!engine) {
    engine = createEngine({
      debug: process.env.NODE_ENV !== 'production',
      hypervisor: {
        maxTicksPerTurn: 15,
        maxDemonsPerTick: 4,
        maxMemorySlots: 80,
        tickTimeoutMs: 300,
      },
    });
    console.log('Intelligence Engine initialized. No LLM required.');
  }
  return engine;
}

/**
 * POST /api/chat
 * Send a message and get a Socratic response from the intelligence engine.
 *
 * Body: { message: string, conversationId?: string }
 * Response: { response: string, conversationId: string, engine?: object }
 */
engineChatRouter.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message, conversationId } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    if (message.length > 5000) {
      return res.status(400).json({ error: 'Message too long. Keep it under 5000 characters.' });
    }

    // Create or get conversation
    let convId = conversationId;
    let isNew = false;

    if (!convId || !getConversation(convId)) {
      convId = nanoid(12);
      createConversation(convId);
      isNew = true;
    }

    // Save user message
    addMessage(nanoid(12), convId, 'user', message.trim());

    // Process through the intelligence engine (NO LLM CALL)
    const eng = getEngine();
    const result = eng.process(message.trim());

    // Save engine response
    addMessage(nanoid(12), convId, 'assistant', result.text);

    // Auto-generate title from first message
    if (isNew) {
      updateConversation(convId, { title: generateTitle(message.trim()) });
    }

    const responseBody: Record<string, unknown> = {
      response: result.text,
      conversationId: convId,
    };

    // Include debug info in non-production
    if (result.debug) {
      responseBody.engine = result.debug;
    }

    res.json(responseBody);
  } catch (error: unknown) {
    const err = error as Error;
    console.error('Engine chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/chat/stream
 * Send a message and stream the response.
 * Note: Since the engine is synchronous (no network calls),
 * the response is instant. We still use SSE format for client compatibility.
 */
engineChatRouter.post('/chat/stream', async (req: Request, res: Response) => {
  try {
    const { message, conversationId } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    // Create or get conversation
    let convId = conversationId;
    let isNew = false;

    if (!convId || !getConversation(convId)) {
      convId = nanoid(12);
      createConversation(convId);
      isNew = true;
    }

    // Save user message
    addMessage(nanoid(12), convId, 'user', message.trim());

    // Process through engine
    const eng = getEngine();
    const result = eng.process(message.trim());

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Conversation-Id', convId);

    // Stream the response word by word for a natural feel
    const words = result.text.split(' ');
    for (let i = 0; i < words.length; i++) {
      const chunk = (i === 0 ? '' : ' ') + words[i];
      res.write(`data: ${JSON.stringify({ chunk, conversationId: convId })}\n\n`);
    }

    // Save the complete response
    addMessage(nanoid(12), convId, 'assistant', result.text);

    if (isNew) {
      updateConversation(convId, { title: generateTitle(message.trim()) });
    }

    res.write(`data: ${JSON.stringify({ done: true, conversationId: convId })}\n\n`);
    res.end();
  } catch (error: unknown) {
    const err = error as Error;
    console.error('Engine stream error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/conversations
 * List all conversations.
 */
engineChatRouter.get('/conversations', (_req: Request, res: Response) => {
  const conversations = listConversations();
  res.json({ conversations });
});

/**
 * GET /api/conversations/:id/messages
 * Get messages for a conversation.
 */
engineChatRouter.get('/conversations/:id/messages', (req: Request, res: Response) => {
  const { id } = req.params;
  const conv = getConversation(id);

  if (!conv) {
    return res.status(404).json({ error: 'Conversation not found.' });
  }

  const messages = getMessages(id, 100);
  res.json({ conversation: conv, messages });
});

/**
 * DELETE /api/conversations/:id
 * Delete a conversation and its messages.
 */
engineChatRouter.delete('/conversations/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  deleteConversation(id);
  res.json({ ok: true });
});

/**
 * GET /api/status
 * Check system status including engine stats.
 */
engineChatRouter.get('/status', (_req: Request, res: Response) => {
  const eng = getEngine();
  const stats = eng.stats();

  res.json({
    status: 'ok',
    engine: {
      mode: 'intelligence_engine',
      llm_required: false,
      ...stats,
    },
    demons: eng.listDemons(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/engine/stats
 * Detailed engine statistics.
 */
engineChatRouter.get('/engine/stats', (_req: Request, res: Response) => {
  const eng = getEngine();
  res.json(eng.stats());
});

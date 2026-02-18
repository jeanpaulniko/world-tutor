import { Router, Request, Response } from 'express';
import { nanoid } from 'nanoid';
import { chat, chatStream, checkLLM } from '../lib/llm.js';
import { buildMessages, generateTitle } from '../lib/socratic.js';
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

export const chatRouter = Router();

/**
 * POST /api/chat
 * Send a message and get a Socratic response.
 *
 * Body: { message: string, conversationId?: string }
 * Response: { response: string, conversationId: string }
 */
chatRouter.post('/chat', async (req: Request, res: Response) => {
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

    // Get conversation history for context
    const history = getRecentMessages(convId, 10);

    // Build messages with Socratic system prompt
    const llmMessages = buildMessages(
      history.slice(0, -1) as Array<{ role: string; content: string }>, // Exclude the message we just added
      message.trim()
    );

    // Get AI response
    const response = await chat(llmMessages);

    // Save assistant response
    addMessage(nanoid(12), convId, 'assistant', response);

    // Auto-generate title from first message
    if (isNew) {
      updateConversation(convId, { title: generateTitle(message.trim()) });
    }

    res.json({
      response,
      conversationId: convId,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('Chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/chat/stream
 * Send a message and stream the Socratic response via SSE.
 *
 * Body: { message: string, conversationId?: string }
 */
chatRouter.post('/chat/stream', async (req: Request, res: Response) => {
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

    // Get conversation history
    const history = getRecentMessages(convId, 10);
    const llmMessages = buildMessages(
      history.slice(0, -1) as Array<{ role: string; content: string }>,
      message.trim()
    );

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Conversation-Id', convId);

    // Stream response
    let fullResponse = '';

    for await (const chunk of chatStream(llmMessages)) {
      fullResponse += chunk;
      res.write(`data: ${JSON.stringify({ chunk, conversationId: convId })}\n\n`);
    }

    // Save complete response
    addMessage(nanoid(12), convId, 'assistant', fullResponse);

    if (isNew) {
      updateConversation(convId, { title: generateTitle(message.trim()) });
    }

    res.write(`data: ${JSON.stringify({ done: true, conversationId: convId })}\n\n`);
    res.end();
  } catch (error: unknown) {
    const err = error as Error;
    console.error('Stream error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/conversations
 * List all conversations.
 */
chatRouter.get('/conversations', (_req: Request, res: Response) => {
  const conversations = listConversations();
  res.json({ conversations });
});

/**
 * GET /api/conversations/:id/messages
 * Get messages for a conversation.
 */
chatRouter.get('/conversations/:id/messages', (req: Request, res: Response) => {
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
chatRouter.delete('/conversations/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  deleteConversation(id);
  res.json({ ok: true });
});

/**
 * GET /api/status
 * Check system status including LLM connectivity.
 */
chatRouter.get('/status', async (_req: Request, res: Response) => {
  const llmStatus = await checkLLM();
  res.json({
    status: 'ok',
    llm: llmStatus,
    timestamp: new Date().toISOString(),
  });
});

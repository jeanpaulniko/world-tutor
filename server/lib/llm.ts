import OpenAI from 'openai';

/**
 * LLM client using OpenAI-compatible API.
 *
 * Supports Groq, Together, OpenRouter, OpenAI, or any
 * OpenAI-compatible endpoint. Just set the env vars.
 *
 * Default: Groq with Llama 3.1 8B ($0.05/1M tokens, free tier available)
 */

const BASE_URL = process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';
const API_KEY = process.env.LLM_API_KEY || '';
const MODEL = process.env.LLM_MODEL || 'llama-3.1-8b-instant';

if (!API_KEY) {
  console.warn(
    '⚠️  LLM_API_KEY not set. Set it in your environment or .env file.\n' +
    '   Get a free key at https://console.groq.com (no credit card needed)\n' +
    '   Example: export LLM_API_KEY=gsk_xxx'
  );
}

const client = new OpenAI({
  baseURL: BASE_URL,
  apiKey: API_KEY,
});

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Send messages to the LLM and get a complete response.
 */
export async function chat(messages: ChatMessage[]): Promise<string> {
  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      max_tokens: 500, // Keep responses short for mobile
      temperature: 0.7, // Balanced creativity
      top_p: 0.9,
    });

    return response.choices[0]?.message?.content || 'I had trouble generating a response. Please try again.';
  } catch (error: unknown) {
    const err = error as Error;
    console.error('LLM error:', err.message);

    if (err.message.includes('401') || err.message.includes('Unauthorized')) {
      throw new Error('Invalid API key. Please check your LLM_API_KEY.');
    }
    if (err.message.includes('429')) {
      throw new Error('Rate limited. Please wait a moment and try again.');
    }
    throw new Error('Failed to get response from AI. Please try again.');
  }
}

/**
 * Stream a response from the LLM (for Server-Sent Events).
 */
export async function* chatStream(messages: ChatMessage[]): AsyncGenerator<string> {
  try {
    const stream = await client.chat.completions.create({
      model: MODEL,
      messages,
      max_tokens: 500,
      temperature: 0.7,
      top_p: 0.9,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  } catch (error: unknown) {
    const err = error as Error;
    console.error('LLM stream error:', err.message);
    yield 'I had trouble generating a response. Please try again.';
  }
}

/**
 * Check if the LLM is configured and reachable.
 */
export async function checkLLM(): Promise<{ ok: boolean; error?: string }> {
  if (!API_KEY) {
    return { ok: false, error: 'LLM_API_KEY not set' };
  }

  try {
    await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 5,
    });
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: (error as Error).message };
  }
}

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Message, MessageData } from './Message';
import { InputBar } from './InputBar';

interface ChatProps {
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
}

export function Chat({ conversationId, onConversationCreated }: ChatProps) {
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevConvId = useRef<string | null>(null);

  // Load messages when conversation changes
  useEffect(() => {
    if (conversationId && conversationId !== prevConvId.current) {
      prevConvId.current = conversationId;
      loadMessages(conversationId);
    } else if (!conversationId) {
      prevConvId.current = null;
      setMessages([]);
    }
  }, [conversationId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadMessages(convId: string) {
    try {
      const res = await fetch(`/api/conversations/${convId}/messages`);
      if (res.ok) {
        const data = await res.json();
        setMessages(
          data.messages.map((m: { id: string; role: string; content: string; created_at: string }) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: m.created_at,
          }))
        );
      }
    } catch {
      // Silently fail — might be offline
    }
  }

  const handleSend = useCallback(async (text: string) => {
    setError(null);

    // Add user message immediately
    const userMsg: MessageData = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to get response');
      }

      const data = await res.json();

      // Add assistant response
      const assistantMsg: MessageData = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Notify parent of new conversation
      if (!conversationId && data.conversationId) {
        onConversationCreated(data.conversationId);
      }
    } catch (err: unknown) {
      const error = err as Error;
      setError(error.message);

      // Save to offline queue if network error
      if (!navigator.onLine) {
        saveToOfflineQueue(text, conversationId);
        setError('You are offline. Your message will be sent when you reconnect.');
      }
    } finally {
      setLoading(false);
    }
  }, [conversationId, onConversationCreated]);

  return (
    <div className="chat">
      <div className="messages">
        {messages.length === 0 && !loading && (
          <div className="welcome">
            <div className="welcome-icon">?</div>
            <h2>Ask me anything</h2>
            <p>I'll help you learn through questions, not answers.</p>
            <p className="welcome-hint">Math, science, history, coding, languages — any subject, any language.</p>
            <div className="welcome-examples">
              <button onClick={() => handleSend("How do volcanoes work?")}>How do volcanoes work?</button>
              <button onClick={() => handleSend("Teach me basic Spanish")}>Teach me basic Spanish</button>
              <button onClick={() => handleSend("How do I solve quadratic equations?")}>Quadratic equations</button>
              <button onClick={() => handleSend("What caused World War 1?")}>What caused WW1?</button>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <Message key={msg.id} data={msg} />
        ))}

        {loading && (
          <div className="message assistant">
            <div className="message-bubble thinking">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          </div>
        )}

        {error && (
          <div className="error-banner">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <InputBar onSend={handleSend} disabled={loading} />
    </div>
  );
}

function saveToOfflineQueue(message: string, conversationId: string | null) {
  try {
    const queue = JSON.parse(localStorage.getItem('offlineQueue') || '[]');
    queue.push({ message, conversationId, timestamp: Date.now() });
    localStorage.setItem('offlineQueue', JSON.stringify(queue));
  } catch {
    // Storage full or unavailable
  }
}

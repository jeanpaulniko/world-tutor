import React, { useEffect, useState } from 'react';

interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  activeId: string | null;
  refreshKey: number;
}

export function Sidebar({ open, onClose, onSelect, onNewChat, activeId, refreshKey }: SidebarProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    loadConversations();
  }, [refreshKey]);

  async function loadConversations() {
    try {
      const res = await fetch('/api/conversations');
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations);
      }
    } catch {
      // Offline — show cached if available
    }
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    try {
      await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) {
        onNewChat();
      }
    } catch {
      // Silently fail
    }
  }

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="sidebar-header">
        <h2>Conversations</h2>
        <button onClick={onClose} aria-label="Close menu" className="close-btn">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <button className="new-chat-sidebar-btn" onClick={onNewChat}>
        + New conversation
      </button>

      <div className="conversation-list">
        {conversations.length === 0 && (
          <p className="empty-state">No conversations yet. Start learning!</p>
        )}
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`conversation-item ${activeId === conv.id ? 'active' : ''}`}
            onClick={() => onSelect(conv.id)}
          >
            <span className="conversation-title">
              {conv.title || 'Untitled'}
            </span>
            <button
              className="delete-btn"
              onClick={(e) => handleDelete(e, conv.id)}
              aria-label="Delete conversation"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <p>Free & open source</p>
        <a href="https://github.com/jeanpaulniko/world-tutor" target="_blank" rel="noopener">
          GitHub
        </a>
      </div>
    </aside>
  );
}

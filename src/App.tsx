import React, { useState, useCallback } from 'react';
import { Chat } from './components/Chat';
import { Sidebar } from './components/Sidebar';

interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

export function App() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleNewChat = useCallback(() => {
    setConversationId(null);
    setSidebarOpen(false);
  }, []);

  const handleSelectConversation = useCallback((id: string) => {
    setConversationId(id);
    setSidebarOpen(false);
  }, []);

  const handleConversationCreated = useCallback((id: string) => {
    setConversationId(id);
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <button
          className="menu-btn"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <h1 className="header-title">
          <span className="header-icon">?</span> World Tutor
        </h1>
        <button className="new-chat-btn" onClick={handleNewChat} aria-label="New conversation">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </header>

      {/* Sidebar */}
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelect={handleSelectConversation}
        onNewChat={handleNewChat}
        activeId={conversationId}
        refreshKey={refreshKey}
      />

      {/* Overlay */}
      {sidebarOpen && (
        <div className="overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Chat */}
      <main className="main">
        <Chat
          conversationId={conversationId}
          onConversationCreated={handleConversationCreated}
        />
      </main>
    </div>
  );
}

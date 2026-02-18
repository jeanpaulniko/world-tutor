import React from 'react';

export interface MessageData {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface MessageProps {
  data: MessageData;
}

export function Message({ data }: MessageProps) {
  return (
    <div className={`message ${data.role}`}>
      <div className="message-bubble">
        {data.content}
      </div>
    </div>
  );
}

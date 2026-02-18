import express from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import { engineChatRouter } from './routes/engine-chat.js';
import { initDb } from './lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors());
app.use(compression());
app.use(express.json());

// API routes — powered by Intelligence Engine (no LLM required)
app.use('/api', engineChatRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    engine: 'intelligence_engine',
    llm_required: false,
    timestamp: new Date().toISOString(),
  });
});

// Serve static frontend in production
if (process.env.NODE_ENV === 'production') {
  const clientPath = path.join(__dirname, '../client');
  app.use(express.static(clientPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
  });
}

// Initialize database and start server
initDb();

app.listen(PORT, () => {
  console.log(`World Tutor running on http://localhost:${PORT}`);
  console.log(`Engine: Intelligence Engine (no LLM, no API costs)`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

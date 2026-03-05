/**
 * Lightweight local session viewer API.
 *
 * ais server  →  http://localhost:3900
 *
 * Endpoints:
 *   GET /sessions
 *   GET /sessions/:id
 *   GET /sessions/:id/timeline
 *   GET /sessions/:id/turns
 *   GET /sessions/:id/files
 */

import Fastify from 'fastify';
import { consoleLog, consoleError } from '../logger.js';
import {
  listNormalizedSessions,
  getNormalizedSession,
  readTimeline,
  readTurns,
  readFileEvents,
} from '../sessionModel/sessionStore.js';
import { listSessions } from '../db.js';
import { getDb } from '../db.js';
import { generateHandoff } from '../handoff/generateHandoff.js';

const PORT = 3900;
const HOST = '127.0.0.1';

export async function startServer(): Promise<void> {
  const fastify = Fastify({ logger: false });

  // CORS: restrict to localhost origins only (prevents cross-origin browser exfiltration)
  fastify.addHook('onSend', async (req, reply) => {
    const origin = req.headers['origin'] ?? '';
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin) ||
        /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) {
      void reply.header('Access-Control-Allow-Origin', origin);
    }
  });

  // ── Routes ──────────────────────────────────────────────────────────────────

  fastify.get('/', async () => ({
    name: 'AI Session Sync API',
    version: '2.5.0',
    endpoints: [
      'GET /sessions',
      'GET /sessions/:id',
      'GET /sessions/:id/timeline',
      'GET /sessions/:id/turns',
      'GET /sessions/:id/files',
      'GET /sessions/:id/handoff',
    ],
  }));

  fastify.get('/sessions', async () => {
    const normalized = listNormalizedSessions();
    // also include raw indexed sessions not yet normalized
    const db = getDb();
    const raw = listSessions(db, 500);
    const normalizedIds = new Set(normalized.map((s) => s.sessionId));
    const rawOnly = raw.filter((r) => !normalizedIds.has(r.id)).map((r) => ({
      sessionId: r.id,
      source: r.source,
      kind: r.kind,
      projectHint: r.project_hint,
      updatedAt: new Date(r.updated_at_ms).toISOString(),
      normalized: false,
    }));
    return [
      ...normalized.map((s) => ({ ...s, normalized: true })),
      ...rawOnly,
    ];
  });

  fastify.get<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
    const meta = getNormalizedSession(req.params.id);
    if (!meta) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return meta;
  });

  fastify.get<{ Params: { id: string } }>('/sessions/:id/timeline', async (req, reply) => {
    const meta = getNormalizedSession(req.params.id);
    if (!meta) return reply.status(404).send({ error: 'Session not found' });
    return readTimeline(meta.sessionId);
  });

  fastify.get<{ Params: { id: string } }>('/sessions/:id/turns', async (req, reply) => {
    const meta = getNormalizedSession(req.params.id);
    if (!meta) return reply.status(404).send({ error: 'Session not found' });
    const turns = await readTurns(meta.sessionId);
    return turns;
  });

  fastify.get<{ Params: { id: string } }>('/sessions/:id/files', async (req, reply) => {
    const meta = getNormalizedSession(req.params.id);
    if (!meta) return reply.status(404).send({ error: 'Session not found' });
    return readFileEvents(meta.sessionId);
  });

  fastify.get<{ Params: { id: string } }>('/sessions/:id/handoff', async (req, reply) => {
    const meta = getNormalizedSession(req.params.id);
    if (!meta) return reply.status(404).send({ error: 'Session not found' });
    try {
      const data = await generateHandoff(req.params.id, { format: 'json', includeGit: true });
      return data;
    } catch (err) {
      return reply.status(500).send({ error: String(err) });
    }
  });

  // ── Start ───────────────────────────────────────────────────────────────────

  try {
    await fastify.listen({ port: PORT, host: HOST });
    consoleLog(`Session viewer API running at http://${HOST}:${PORT}`);
    consoleLog('Press Ctrl+C to stop.');
  } catch (err) {
    consoleError(`Failed to start server: ${String(err)}`);
    process.exit(1);
  }

  // keep alive
  await new Promise<never>(() => { /* forever */ });
}

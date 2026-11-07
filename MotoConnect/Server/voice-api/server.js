import express from 'express';
import jwt from 'jsonwebtoken';
import { AccessToken } from 'livekit-server-sdk';
import Database from 'better-sqlite3';
import { Telegraf } from 'telegraf';
import { connectedComponent, getFreshPresence, publicPresence } from './proximity.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const requiredEnv = ['APP_JWT_SECRET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME'];
for (const key of requiredEnv) {
  if (!process.env[key]) throw new Error('Missing required environment variable: ' + key);
}
if (process.env.APP_JWT_SECRET.length < 32) {
  throw new Error('APP_JWT_SECRET must contain at least 32 characters.');
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

const dbPath = resolve(process.env.DB_PATH || './data/motoconnect.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL, created_at INTEGER NOT NULL,
    blocked INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS auth_challenges (
    challenge_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL, telegram_id TEXT,
    completed_at INTEGER, consumed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
    refresh_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL, revoked_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS presence (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    latitude REAL NOT NULL, longitude REAL NOT NULL,
    enabled INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
`);

const now = () => Date.now();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
const botUsername = process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, '');

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function makeUserId() {
  return 'MC-' + randomBytes(5).toString('hex').toUpperCase();
}
function findOrCreateTelegramUser(from) {
  const telegramId = String(from.id);
  let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  const displayName = [from.first_name, from.last_name].filter(Boolean).join(' ').trim()
    || from.username || 'MotoConnect user';
  if (user) {
    if (displayName !== user.display_name) {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, user.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }
    return user;
  }
  let id;
  do { id = makeUserId(); } while (db.prepare('SELECT 1 FROM users WHERE id = ?').get(id));
  db.prepare('INSERT INTO users (id, telegram_id, display_name, created_at) VALUES (?, ?, ?, ?)')
    .run(id, telegramId, displayName, now());
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
function issueSession(user) {
  const sessionId = randomToken(18);
  const refreshToken = randomToken(48);
  const createdAt = now();
  const expiresAt = createdAt + 30 * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions (id, user_id, refresh_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(sessionId, user.id, sha256(refreshToken), createdAt, expiresAt);
  const accessToken = jwt.sign(
    { sid: sessionId, name: user.display_name }, process.env.APP_JWT_SECRET,
    { subject: user.id, issuer: 'motoconnect-auth', expiresIn: '15m', algorithm: 'HS256' },
  );
  return {
    accessToken, refreshToken, tokenType: 'Bearer', expiresInSeconds: 900,
    user: { id: user.id, displayName: user.display_name },
  };
}
function authenticate(req, res, next) {
  const match = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const claims = jwt.verify(match[1], process.env.APP_JWT_SECRET, {
      algorithms: ['HS256'], issuer: 'motoconnect-auth',
    });
    const session = db.prepare('SELECT s.id, s.user_id, s.expires_at, s.revoked_at, u.display_name, u.blocked FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.user_id = ?')
      .get(claims.sid, claims.sub);
    if (!session || session.revoked_at || session.expires_at <= now() || session.blocked) {
      return res.status(401).json({ error: 'Session expired or account unavailable.' });
    }
    req.auth = { userId: session.user_id, sessionId: session.id, displayName: session.display_name };
    return next();
  } catch (_) {
    return res.status(401).json({ error: 'Invalid or expired access token.' });
  }
}
function readFreshPresence() {
  const rows = db.prepare('SELECT p.user_id AS userId, u.display_name AS displayName, p.latitude, p.longitude, p.enabled, p.updated_at AS updatedAt FROM presence p JOIN users u ON u.id = p.user_id WHERE u.blocked = 0').all();
  const fresh = getFreshPresence(rows, now());
  db.prepare('DELETE FROM presence WHERE updated_at < ?').run(now() - 90_000);
  return fresh;
}
function getCurrentComponent(userId) {
  return connectedComponent(readFreshPresence(), userId);
}

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'motoconnect-auth-presence-api' }));

app.post('/api/auth/challenge', (_req, res) => {
  const challenge = randomToken(24);
  const createdAt = now();
  db.prepare('INSERT INTO auth_challenges (challenge_hash, created_at, expires_at) VALUES (?, ?, ?)')
    .run(sha256(challenge), createdAt, createdAt + 5 * 60 * 1000);
  return res.status(201).json({
    challengeId: challenge,
    botUrl: 'https://t.me/' + botUsername + '?start=auth_' + challenge,
    expiresInSeconds: 300, pollIntervalSeconds: 2,
  });
});

app.post('/api/auth/challenge/poll', (req, res) => {
  const challenge = req.body && req.body.challengeId;
  if (typeof challenge !== 'string' || challenge.length < 20 || challenge.length > 128) {
    return res.status(400).json({ error: 'Invalid challenge.' });
  }
  const row = db.prepare('SELECT * FROM auth_challenges WHERE challenge_hash = ?').get(sha256(challenge));
  if (!row || row.expires_at <= now()) return res.status(410).json({ error: 'Challenge expired. Start again.' });
  if (!row.completed_at || !row.telegram_id) return res.status(202).json({ status: 'pending' });
  if (row.consumed_at) return res.status(409).json({ error: 'Challenge already used.' });
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ? AND blocked = 0').get(row.telegram_id);
  if (!user) return res.status(403).json({ error: 'Account unavailable.' });
  const result = db.prepare('UPDATE auth_challenges SET consumed_at = ? WHERE challenge_hash = ? AND consumed_at IS NULL')
    .run(now(), row.challenge_hash);
  if (result.changes !== 1) return res.status(409).json({ error: 'Challenge already used.' });
  return res.json({ status: 'authenticated', ...issueSession(user) });
});

app.post('/api/auth/refresh', (req, res) => {
  const refreshToken = req.body && req.body.refreshToken;
  if (typeof refreshToken !== 'string' || refreshToken.length < 40) {
    return res.status(401).json({ error: 'Invalid refresh token.' });
  }
  const oldHash = sha256(refreshToken);
  const session = db.prepare('SELECT s.*, u.display_name, u.blocked FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.refresh_hash = ?').get(oldHash);
  if (!session || session.revoked_at || session.expires_at <= now() || session.blocked) {
    return res.status(401).json({ error: 'Refresh token expired or revoked.' });
  }
  const newRefresh = randomToken(48);
  const updated = db.prepare('UPDATE sessions SET refresh_hash = ? WHERE id = ? AND refresh_hash = ? AND revoked_at IS NULL')
    .run(sha256(newRefresh), session.id, oldHash);
  if (updated.changes !== 1) return res.status(401).json({ error: 'Refresh token already rotated.' });
  const accessToken = jwt.sign(
    { sid: session.id, name: session.display_name }, process.env.APP_JWT_SECRET,
    { subject: session.user_id, issuer: 'motoconnect-auth', expiresIn: '15m', algorithm: 'HS256' },
  );
  return res.json({
    accessToken, refreshToken: newRefresh, tokenType: 'Bearer', expiresInSeconds: 900,
    user: { id: session.user_id, displayName: session.display_name },
  });
});

app.post('/api/auth/logout', authenticate, (req, res) => {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(now(), req.auth.sessionId);
  db.prepare('DELETE FROM presence WHERE user_id = ?').run(req.auth.userId);
  return res.json({ status: 'logged_out' });
});
app.get('/api/auth/me', authenticate, (req, res) => res.json({
  user: { id: req.auth.userId, displayName: req.auth.displayName },
}));

app.post('/api/presence', authenticate, (req, res) => {
  const body = req.body || {};
  if (body.enabled === false) {
    db.prepare('DELETE FROM presence WHERE user_id = ?').run(req.auth.userId);
    return res.json({ enabled: false, roomName: null, participantCount: 0, participants: [] });
  }
  const latitude = body.latitude;
  const longitude = body.longitude;
  if (body.enabled !== true || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Set enabled=true and provide valid latitude/longitude.' });
  }
  db.prepare('INSERT INTO presence (user_id, latitude, longitude, enabled, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(user_id) DO UPDATE SET latitude=excluded.latitude, longitude=excluded.longitude, enabled=1, updated_at=excluded.updated_at')
    .run(req.auth.userId, latitude, longitude, now());
  const component = getCurrentComponent(req.auth.userId);
  return res.json({ enabled: true, ...publicPresence(component, req.auth.userId) });
});
app.get('/api/presence/me', authenticate, (req, res) => {
  const component = getCurrentComponent(req.auth.userId);
  return res.json(publicPresence(component, req.auth.userId));
});

app.post('/api/voice/token', authenticate, async (req, res) => {
  if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    return res.status(503).json({ error: 'Voice service is not configured on the server.' });
  }
  const requestedRoom = req.body && req.body.roomName;
  const component = getCurrentComponent(req.auth.userId);
  if (component.length < 2) return res.status(403).json({ error: 'No other eligible rider is nearby.' });
  const currentRoom = publicPresence(component, req.auth.userId).roomName;
  if (typeof requestedRoom !== 'string' || !safeEqual(requestedRoom, currentRoom)) {
    return res.status(403).json({ error: 'You are no longer a member of this proximity room.' });
  }
  try {
    const participant = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: req.auth.userId, name: req.auth.displayName, ttl: '5m',
    });
    participant.addGrant({ roomJoin: true, room: currentRoom, canPublish: true, canSubscribe: true });
    return res.json({
      serverUrl: process.env.LIVEKIT_URL,
      participantToken: await participant.toJwt(),
      roomName: currentRoom, expiresInSeconds: 300,
    });
  } catch (_) {
    return res.status(500).json({ error: 'Could not issue a voice token.' });
  }
});

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
bot.start(async (ctx) => {
  const payload = (ctx.startPayload || '').trim();
  if (!payload.startsWith('auth_')) {
    await ctx.reply('MotoConnect: открой приложение и нажми «Войти через Telegram», чтобы привязать аккаунт.');
    return;
  }
  const challenge = payload.slice(5);
  if (challenge.length < 20 || challenge.length > 128) {
    await ctx.reply('Ссылка авторизации недействительна. Создай новую в приложении.');
    return;
  }
  const hash = sha256(challenge);
  const row = db.prepare('SELECT * FROM auth_challenges WHERE challenge_hash = ?').get(hash);
  if (!row || row.expires_at <= now() || row.completed_at) {
    await ctx.reply('Ссылка авторизации истекла или уже использована. Начни вход заново в приложении.');
    return;
  }
  const user = findOrCreateTelegramUser(ctx.from);
  db.prepare('UPDATE auth_challenges SET telegram_id = ?, completed_at = ? WHERE challenge_hash = ? AND completed_at IS NULL')
    .run(String(ctx.from.id), now(), hash);
  await ctx.reply('Аккаунт подтверждён!\nТвой MotoConnect ID: ' + user.id + '\nВернись в приложение — вход завершится автоматически.');
});
bot.catch((error) => process.stderr.write('Telegram bot error: ' + error.message + '\n'));

const port = Number(process.env.PORT || 8080);
const server = app.listen(port, '0.0.0.0', () => process.stdout.write('MotoConnect API listening on port ' + port + '\n'));
bot.launch().catch((error) => {
  process.stderr.write('Telegram bot failed to start: ' + error.message + '\n');
  server.close(() => process.exit(1));
});
async function shutdown() {
  bot.stop('SIGTERM');
  server.close();
  db.close();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

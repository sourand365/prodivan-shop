import express from 'express';
import jwt from 'jsonwebtoken';
import { AccessToken } from 'livekit-server-sdk';

const requiredEnv = [
  'LIVEKIT_URL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'APP_JWT_SECRET',
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

function authenticateApprovedUser(req, res, next) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const claims = jwt.verify(match[1], process.env.APP_JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'motoconnect-auth',
    });

    if (
      typeof claims.sub !== 'string' ||
      claims.sub.length < 1 ||
      claims.approved !== true ||
      claims.blocked === true
    ) {
      return res.status(403).json({ error: 'Account is not approved for voice.' });
    }

    req.user = claims;
    return next();
  } catch (_) {
    return res.status(401).json({ error: 'Invalid or expired access token.' });
  }
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'motoconnect-voice-api' });
});

app.post('/api/voice/token', authenticateApprovedUser, async (req, res) => {
  const roomName = req.body && req.body.roomName;

  if (
    typeof roomName !== 'string' ||
    roomName.length > 128 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(roomName)
  ) {
    return res.status(400).json({ error: 'A valid roomName is required.' });
  }

  const allowedRooms = Array.isArray(req.user.voiceRooms)
    ? req.user.voiceRooms
    : [];

  if (!allowedRooms.includes(roomName)) {
    return res.status(403).json({ error: 'You are not a member of this voice room.' });
  }

  try {
    const participant = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      {
        identity: req.user.sub,
        name: typeof req.user.name === 'string' ? req.user.name : req.user.sub,
        ttl: '5m',
      },
    );

    participant.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await participant.toJwt();

    return res.json({
      serverUrl: process.env.LIVEKIT_URL,
      participantToken: token,
      roomName,
      expiresInSeconds: 300,
    });
  } catch (_) {
    return res.status(500).json({ error: 'Could not issue a voice token.' });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, '0.0.0.0', () => {
  process.stdout.write(`MotoConnect voice API listening on port ${port}\\n`);
});

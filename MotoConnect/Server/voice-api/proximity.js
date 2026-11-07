import { createHash } from 'node:crypto';

export const PROXIMITY_RADIUS_METRES = 1000;
export const PRESENCE_TTL_MS = 90_000;

export function distanceMetres(a, b) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function getFreshPresence(rows, now = Date.now()) {
  return rows.filter((row) =>
    row.enabled === true &&
    Number.isFinite(row.latitude) &&
    Number.isFinite(row.longitude) &&
    row.latitude >= -90 && row.latitude <= 90 &&
    row.longitude >= -180 && row.longitude <= 180 &&
    Number.isFinite(row.updatedAt) &&
    now - row.updatedAt >= 0 &&
    now - row.updatedAt <= PRESENCE_TTL_MS
  );
}

// Returns the full connected component. A-B and B-C can connect A to C
// even when A-C itself is more than one kilometre.
export function connectedComponent(rows, userId, radius = PROXIMITY_RADIUS_METRES) {
  const byId = new Map(rows.map((row) => [row.userId, row]));
  const start = byId.get(userId);
  if (!start) return [];

  const visited = new Set([userId]);
  const queue = [start];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const candidate of rows) {
      if (visited.has(candidate.userId)) continue;
      if (distanceMetres(current, candidate) <= radius) {
        visited.add(candidate.userId);
        queue.push(candidate);
      }
    }
  }

  return queue;
}

export function proximityRoomName(component) {
  const identities = component.map((row) => row.userId).sort();
  const digest = createHash('sha256').update(identities.join('|')).digest('hex').slice(0, 24);
  return `prox_${digest}`;
}

export function publicPresence(component, userId) {
  const origin = component.find((row) => row.userId === userId);
  if (!origin) return { roomName: null, participantCount: 0, participants: [] };

  return {
    roomName: component.length > 1 ? proximityRoomName(component) : null,
    participantCount: component.length,
    participants: component.map((row) => ({
      id: row.userId,
      name: row.displayName,
      // Approximate marker only; raw coordinates remain server-side.
      latitude: Number(row.latitude.toFixed(4)),
      longitude: Number(row.longitude.toFixed(4)),
      distanceMetres: Math.round(distanceMetres(origin, row)),
    })),
  };
}

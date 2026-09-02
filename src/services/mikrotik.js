/**
 * MikroTik RouterOS helpers.
 * Uses our minimal RouterOS client (no node-routeros dependency).
 */
import { withRouterOS } from './routeros-client.js';

/**
 * Test connection — the most important function in the whole app.
 */
export async function testConnection({ host, port, username, password }) {
  try {
    const result = await withRouterOS(
      { host, port, user: username, password, timeout: 12000 },
      async (api) => {
        const resources = await api.write('/system/resource/print');
        const identity = await api.write('/system/identity/print');

        const res = resources?.[0] || {};
        const id = identity?.[0] || {};

        return {
          identity: id.name || 'Unknown',
          version: res.version || 'Unknown',
          uptime: res.uptime || null,
          board: res['board-name'] || null,
        };
      }
    );

    return {
      success: true,
      ...result,
      testedAt: new Date().toISOString(),
    };
  } catch (err) {
    let message = err.message || 'Unknown connection error';

    if (message.includes('ECONNREFUSED') || message.includes('connect ECONNREFUSED')) {
      message = 'Connection refused. Is the API service enabled on the router and the port open?';
    } else if (message.includes('ETIMEDOUT') || message.includes('timeout') || message.includes('timed out')) {
      message = 'Connection timed out. Check host/IP, port forwarding, and that the router is online.';
    } else if (message.includes('ENOTFOUND') || message.includes('getaddrinfo')) {
      message = 'Could not resolve hostname. Check the DDNS name or IP address.';
    } else if (
      message.toLowerCase().includes('login') ||
      message.toLowerCase().includes('invalid user') ||
      message.toLowerCase().includes('cannot log in')
    ) {
      message = 'Login failed. Check API username and password.';
    } else if (message.includes('ECONNRESET')) {
      message = 'Connection was reset by the router. Try again or check firewall rules.';
    }

    const error = new Error(message);
    error.code = 'MIKROTIK_CONNECTION_FAILED';
    error.original = err.message;
    throw error;
  }
}

/**
 * Create hotspot users on the router for a list of voucher codes.
 */
export async function createHotspotUsers({ host, port, username, password, users }) {
  return withRouterOS(
    { host, port, user: username, password, timeout: 30000 },
    async (api) => {
      const created = [];
      const errors = [];

      for (const user of users) {
        try {
          const params = [
            `=name=${user.name}`,
            `=password=${user.password || user.name}`,
          ];

          if (user.limitUptime) {
            params.push(`=limit-uptime=${user.limitUptime}`);
          }
          if (user.limitBytesTotal) {
            params.push(`=limit-bytes-total=${user.limitBytesTotal}`);
          }
          if (user.comment) {
            params.push(`=comment=${user.comment}`);
          }

          await api.write('/ip/hotspot/user/add', params);
          created.push(user.name);
        } catch (err) {
          errors.push({ code: user.name, error: err.message });
        }
      }

      if (errors.length > 0 && created.length === 0) {
        const error = new Error('Failed to create any users on the router');
        error.details = errors;
        throw error;
      }

      return { created, errors };
    }
  );
}

/**
 * Check real usage of hotspot users on the router — how much of their
 * time/data limit each voucher code has actually consumed. This is
 * what lets the dashboard show real status instead of "unused"
 * forever; RouterOS enforces the limits itself regardless of whether
 * anything ever reads this back, but nothing did until now.
 */
export async function getHotspotUserUsage({ host, port, username, password, codes }) {
  return withRouterOS(
    { host, port, user: username, password, timeout: 20000 },
    async (api) => {
      const rows = await api.write('/ip/hotspot/user/print');
      const byName = new Map((rows || []).filter((r) => r.name).map((r) => [r.name, r]));

      const result = {};
      for (const code of codes) {
        const row = byName.get(code);
        if (!row) {
          result[code] = { exists: false };
          continue;
        }
        const uptimeSeconds = parseRouterOSDuration(row.uptime);
        const limitUptimeSeconds = parseRouterOSDuration(row['limit-uptime']);
        const bytesIn = Number(row['bytes-in'] || 0);
        const bytesOut = Number(row['bytes-out'] || 0);
        const bytesTotal = bytesIn + bytesOut;
        const limitBytesTotal = Number(row['limit-bytes-total'] || 0);

        result[code] = {
          exists: true,
          uptimeSeconds,
          limitUptimeSeconds,
          bytesTotal,
          limitBytesTotal,
        };
      }
      return result;
    }
  );
}

/**
 * RouterOS duration strings look like "1d2h3m4s", "5m30s", "0s" — never
 * fractional seconds, components omitted when zero. Returns seconds.
 */
function parseRouterOSDuration(str) {
  if (!str || str === '0s') return 0;
  const re = /(\d+)([wdhms])/g;
  const unitSeconds = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  let total = 0;
  let match;
  let matchedAnything = false;
  while ((match = re.exec(str)) !== null) {
    matchedAnything = true;
    total += Number(match[1]) * unitSeconds[match[2]];
  }
  return matchedAnything ? total : 0;
}

export function minutesToUptime(minutes) {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h${m}m` : `${h}h`;
  }
  const d = Math.floor(minutes / 1440);
  const rem = minutes % 1440;
  const h = Math.floor(rem / 60);
  return h > 0 ? `${d}d${h}h` : `${d}d`;
}

export function mbToBytes(mb) {
  if (!mb || mb <= 0) return null;
  return Math.floor(mb * 1024 * 1024);
}

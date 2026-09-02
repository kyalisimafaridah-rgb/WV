/**
 * Minimal RouterOS API client (no external deps).
 * Implements only what we need: connect, login, write commands, close.
 * Protocol: https://help.mikrotik.com/docs/display/ROS/API
 */
import net from 'net';

function encodeLength(len) {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x4000) {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(len | 0x8000);
    return b;
  }
  if (len < 0x200000) {
    const b = Buffer.alloc(3);
    b[0] = (len >> 16) | 0xc0;
    b[1] = (len >> 8) & 0xff;
    b[2] = len & 0xff;
    return b;
  }
  if (len < 0x10000000) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(len | 0xe0000000);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = 0xf0;
  b.writeUInt32BE(len, 1);
  return b;
}

function encodeWord(word) {
  const data = Buffer.from(String(word), 'utf8');
  return Buffer.concat([encodeLength(data.length), data]);
}

function encodeSentence(words) {
  const parts = words.map(encodeWord);
  parts.push(Buffer.from([0x00])); // end of sentence
  return Buffer.concat(parts);
}

/**
 * Decode length from buffer starting at offset. Returns { length, size } where size is bytes consumed.
 */
function decodeLength(buf, offset) {
  if (offset >= buf.length) return null;
  const b0 = buf[offset];
  if ((b0 & 0x80) === 0) return { length: b0, size: 1 };
  if ((b0 & 0xc0) === 0x80) {
    if (offset + 1 >= buf.length) return null;
    return { length: ((b0 & 0x3f) << 8) + buf[offset + 1], size: 2 };
  }
  if ((b0 & 0xe0) === 0xc0) {
    if (offset + 2 >= buf.length) return null;
    return { length: ((b0 & 0x1f) << 16) + (buf[offset + 1] << 8) + buf[offset + 2], size: 3 };
  }
  if ((b0 & 0xf0) === 0xe0) {
    if (offset + 3 >= buf.length) return null;
    return {
      length: ((b0 & 0x0f) << 24) + (buf[offset + 1] << 16) + (buf[offset + 2] << 8) + buf[offset + 3],
      size: 4,
    };
  }
  if (b0 === 0xf0) {
    if (offset + 4 >= buf.length) return null;
    return { length: buf.readUInt32BE(offset + 1), size: 5 };
  }
  throw new Error('Invalid RouterOS length encoding');
}

/**
 * Parse one or more sentences from a buffer.
 * Returns { sentences: [[{type, key, value}...]], rest }
 */
function parseSentences(buf) {
  const sentences = [];
  let offset = 0;
  let current = [];

  while (offset < buf.length) {
    const lenInfo = decodeLength(buf, offset);
    if (!lenInfo) break;
    if (lenInfo.length === 0 && lenInfo.size === 1) {
      // end of sentence
      offset += 1;
      if (current.length > 0) {
        sentences.push(current);
        current = [];
      }
      continue;
    }
    offset += lenInfo.size;
    if (offset + lenInfo.length > buf.length) break;
    const word = buf.slice(offset, offset + lenInfo.length).toString('utf8');
    offset += lenInfo.length;

    if (word.startsWith('!')) {
      current.push({ type: word });
    } else if (word.startsWith('=')) {
      const eq = word.indexOf('=', 1);
      if (eq === -1) {
        current.push({ type: 'attr', key: word.slice(1), value: '' });
      } else {
        current.push({ type: 'attr', key: word.slice(1, eq), value: word.slice(eq + 1) });
      }
    } else if (word.startsWith('.')) {
      current.push({ type: 'query', key: word });
    } else {
      current.push({ type: 'word', value: word });
    }
  }

  const rest = offset < buf.length ? buf.slice(offset) : Buffer.alloc(0);
  return { sentences, rest };
}

function sentenceToObject(sentence) {
  const obj = { _type: null };
  for (const item of sentence) {
    if (item.type && item.type.startsWith('!')) {
      obj._type = item.type;
    } else if (item.type === 'attr') {
      obj[item.key] = item.value;
    }
  }
  return obj;
}

export class RouterOSClient {
  constructor({ host, port = 8728, user, password, timeout = 15000 }) {
    this.host = host;
    this.port = Number(port) || 8728;
    this.user = user;
    this.password = password;
    this.timeout = timeout;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = [];
    this.connected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._destroy();
        reject(new Error(`Connection timed out after ${this.timeout}ms`));
      }, this.timeout);

      this.socket = net.createConnection({ host: this.host, port: this.port }, async () => {
        try {
          clearTimeout(timer);
          this.connected = true;
          this.socket.setTimeout(this.timeout);
          this.socket.on('data', (chunk) => this._onData(chunk));
          this.socket.on('error', (err) => this._failAll(err));
          this.socket.on('close', () => {
            this.connected = false;
            this._failAll(new Error('Connection closed'));
          });
          this.socket.on('timeout', () => {
            this._destroy();
            this._failAll(new Error('Socket timeout'));
          });

          await this._login();
          resolve();
        } catch (err) {
          clearTimeout(timer);
          this._destroy();
          reject(err);
        }
      });

      this.socket.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async _login() {
    // Modern login (RouterOS 6.43+): /login with name + password in one sentence
    const result = await this.write('/login', [
      `=name=${this.user}`,
      `=password=${this.password}`,
    ]);
    const reply = result.find((r) => r._type === '!done' || r._type === '!trap');
    if (reply?._type === '!trap') {
      throw new Error(reply.message || 'Login failed');
    }
    if (!reply) {
      throw new Error('Login failed — no response from router');
    }
  }

  write(command, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.socket) {
        return reject(new Error('Not connected'));
      }
      const words = [command, ...params];
      this.pending.push({ resolve, reject, results: [] });
      this.socket.write(encodeSentence(words));
    });
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const { sentences, rest } = parseSentences(this.buffer);
    this.buffer = rest;

    for (const sentence of sentences) {
      const obj = sentenceToObject(sentence);
      const current = this.pending[0];
      if (!current) continue;

      if (obj._type === '!re') {
        current.results.push(obj);
      } else if (obj._type === '!done') {
        this.pending.shift();
        current.resolve(current.results.length ? current.results : [obj]);
      } else if (obj._type === '!trap' || obj._type === '!fatal') {
        this.pending.shift();
        const err = new Error(obj.message || obj['=message'] || 'RouterOS error');
        err.trap = obj;
        current.reject(err);
      }
    }
  }

  _failAll(err) {
    while (this.pending.length) {
      const p = this.pending.shift();
      p.reject(err);
    }
  }

  _destroy() {
    this.connected = false;
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch (_) {}
      this.socket = null;
    }
  }

  close() {
    this._destroy();
  }
}

/**
 * Helper: connect, run fn, always close.
 */
export async function withRouterOS(opts, fn) {
  const client = new RouterOSClient(opts);
  try {
    await client.connect();
    return await fn(client);
  } finally {
    client.close();
  }
}

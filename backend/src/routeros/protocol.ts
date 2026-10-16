/**
 * Codificação do protocolo da API RouterOS (portas 8728/8729).
 * Uma "sentença" é uma sequência de palavras com prefixo de tamanho, terminada por palavra vazia.
 */

const utf8Strict = new TextDecoder('utf-8', { fatal: true });

/** RouterOS armazena texto como bytes; equipamentos configurados pelo Winbox costumam usar Windows-1252. */
export function decodeWord(buf: Buffer): string {
  try {
    return utf8Strict.decode(buf);
  } catch {
    return buf.toString('latin1');
  }
}

export function encodeWord(word: string): Buffer {
  // Mantém compatibilidade com o Winbox: latin1 quando possível, UTF-8 caso contrário.
  const body = /^[\x00-\xff]*$/.test(word) ? Buffer.from(word, 'latin1') : Buffer.from(word, 'utf8');
  return Buffer.concat([encodeLength(body.length), body]);
}

export function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x4000) return Buffer.from([(len >> 8) | 0x80, len & 0xff]);
  if (len < 0x200000) return Buffer.from([(len >> 16) | 0xc0, (len >> 8) & 0xff, len & 0xff]);
  if (len < 0x10000000) return Buffer.from([(len >>> 24) | 0xe0, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  return Buffer.from([0xf0, (len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
}

export function encodeSentence(words: string[]): Buffer {
  return Buffer.concat([...words.map(encodeWord), Buffer.from([0])]);
}

/** Lê o prefixo de tamanho. Retorna null se ainda faltam bytes. */
function readLength(buf: Buffer, off: number): { len: number; size: number } | null {
  if (off >= buf.length) return null;
  const b = buf[off];
  let size: number;
  if ((b & 0x80) === 0) return { len: b, size: 1 };
  if ((b & 0xc0) === 0x80) size = 2;
  else if ((b & 0xe0) === 0xc0) size = 3;
  else if ((b & 0xf0) === 0xe0) size = 4;
  else if (b === 0xf0) size = 5;
  else throw new Error(`Prefixo de tamanho inválido: 0x${b.toString(16)}`);
  if (off + size > buf.length) return null;
  let len: number;
  if (size === 2) len = ((b & 0x3f) << 8) | buf[off + 1];
  else if (size === 3) len = ((b & 0x1f) << 16) | (buf[off + 1] << 8) | buf[off + 2];
  else if (size === 4) len = (((b & 0x0f) << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
  else len = buf.readUInt32BE(off + 1);
  return { len, size };
}

/** Parser incremental: recebe pedaços do socket e emite sentenças completas. */
export class SentenceParser {
  private buf: Buffer = Buffer.alloc(0);
  private words: string[] = [];

  push(chunk: Buffer): string[][] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: string[][] = [];
    let off = 0;
    for (;;) {
      const h = readLength(this.buf, off);
      if (!h || off + h.size + h.len > this.buf.length) break;
      off += h.size;
      if (h.len === 0) {
        out.push(this.words);
        this.words = [];
      } else {
        this.words.push(decodeWord(this.buf.subarray(off, off + h.len)));
        off += h.len;
      }
    }
    this.buf = this.buf.subarray(off);
    return out;
  }
}

export interface Reply {
  type: string; // !re, !done, !trap, !fatal, !empty
  attrs: Record<string, string>;
}

export function parseSentence(words: string[]): Reply {
  const [type, ...rest] = words;
  const attrs: Record<string, string> = {};
  for (const w of rest) {
    if (w.startsWith('=')) {
      const i = w.indexOf('=', 1);
      if (i === -1) attrs[w.slice(1)] = '';
      else attrs[w.slice(1, i)] = w.slice(i + 1);
    } else if (w.startsWith('.tag=')) {
      attrs['.tag'] = w.slice(5);
    } else if (type === '!fatal') {
      attrs.message = w;
    }
  }
  return { type: type ?? '', attrs };
}

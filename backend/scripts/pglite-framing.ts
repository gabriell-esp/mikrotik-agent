/**
 * Correção para o @electric-sql/pglite-socket (só desenvolvimento e testes; produção usa PostgreSQL de verdade).
 *
 * O pglite-socket entrega ao PGlite cada pedaço recebido do TCP como se fosse uma mensagem completa.
 * Mensagens acima de ~64 KB (ex.: uma foto em bytea) chegam em vários pedaços e derrubam o PGlite
 * ("RuntimeError: unreachable"). Aqui os pedaços são acumulados e só mensagens completas do protocolo
 * do PostgreSQL seguem adiante, em ordem.
 *
 * Basta importar este módulo antes de criar o PGLiteSocketServer.
 */
import { PGLiteSocketHandler } from '@electric-sql/pglite-socket';

const SSL_REQUEST = 80877103;
const GSSENC_REQUEST = 80877104;

interface FramingState {
  buf: Buffer;
  started: boolean;
  chain: Promise<unknown>;
}

const proto = PGLiteSocketHandler.prototype as unknown as { handleData: (data: Buffer) => Promise<number>; __framed?: boolean };

if (!proto.__framed) {
  const original = proto.handleData;
  const states = new WeakMap<object, FramingState>();

  proto.handleData = function (this: object, data: Buffer): Promise<number> {
    let st = states.get(this);
    if (!st) {
      st = { buf: Buffer.alloc(0), started: false, chain: Promise.resolve() };
      states.set(this, st);
    }
    st.buf = st.buf.length ? Buffer.concat([st.buf, data]) : data;

    // Separa as mensagens completas. Antes da StartupMessage não há byte de tipo (só o comprimento).
    let end = 0;
    for (;;) {
      const head = st.started ? 1 : 0;
      if (st.buf.length - end < head + 4) break;
      const len = st.buf.readInt32BE(end + head);
      if (st.buf.length - end < head + len) break;
      if (!st.started) {
        const code = st.buf.readInt32BE(end + 4);
        if (code !== SSL_REQUEST && code !== GSSENC_REQUEST) st.started = true;
      }
      end += head + len;
    }
    if (!end) return Promise.resolve(0);
    const complete = st.buf.subarray(0, end);
    st.buf = Buffer.from(st.buf.subarray(end));

    const run = st.chain.then(() => original.call(this, complete));
    st.chain = run.catch(() => undefined);
    return run;
  };
  proto.__framed = true;
}

import { describe, expect, it } from 'vitest';
import { effectivePermissions } from '../src/auth/permissions.js';
import { hashPassword, SecretBox, verifyPassword } from '../src/lib/crypto.js';
import { stripSecrets } from '../src/modules/registry.js';
import { methodOrder } from '../src/routeros/manager.js';
import { parseDuration, versionAtLeast } from '../src/routeros/parse.js';
import { encodeLength, encodeSentence, SentenceParser } from '../src/routeros/protocol.js';
import { sanitize } from '../src/services/audit.js';
import { clockDate, filterLogs, normalizeLogTime } from '../src/services/logs.js';

describe('protocolo da API', () => {
  it('codifica tamanhos em todas as faixas', () => {
    expect([...encodeLength(0x7f)]).toEqual([0x7f]);
    expect([...encodeLength(0x80)]).toEqual([0x80, 0x80]);
    expect([...encodeLength(0x3fff)]).toEqual([0xbf, 0xff]);
    expect([...encodeLength(0x4000)]).toEqual([0xc0, 0x40, 0x00]);
    expect([...encodeLength(0x200000)]).toEqual([0xe0, 0x20, 0x00, 0x00]);
    expect([...encodeLength(0x10000000)]).toEqual([0xf0, 0x10, 0x00, 0x00, 0x00]);
  });

  it('remonta sentenças fragmentadas e com palavras longas', () => {
    const long = 'x'.repeat(20000);
    const buf = Buffer.concat([encodeSentence(['!re', `=message=${long}`]), encodeSentence(['!done'])]);
    const p = new SentenceParser();
    const out: string[][] = [];
    for (let i = 0; i < buf.length; i += 7) out.push(...p.push(buf.subarray(i, i + 7)));
    expect(out).toEqual([['!re', `=message=${long}`], ['!done']]);
  });

  it('preserva acentos em latin1 (Winbox) e UTF-8', () => {
    const p = new SentenceParser();
    const [s] = p.push(encodeSentence(['=comment=Avenida São João']));
    expect(s[0]).toBe('=comment=Avenida São João');
  });
});

describe('parse de valores do RouterOS', () => {
  it('durações v6 e v7', () => {
    expect(parseDuration('1m10s')).toBe(70);
    expect(parseDuration('1w2d3h4m5s')).toBe(604800 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
    expect(parseDuration('1w2d03:04:05')).toBe(604800 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
    expect(parseDuration('00:01:02')).toBe(62);
    expect(parseDuration('450ms')).toBe(0);
    expect(parseDuration(undefined)).toBeNull();
  });

  it('comparação de versões', () => {
    expect(versionAtLeast('7.16.1 (stable)', '7.0')).toBe(true);
    expect(versionAtLeast('6.49.10 (long-term)', '7.0')).toBe(false);
    expect(versionAtLeast('7.1', '7.1')).toBe(true);
  });

  it('horários de log em formatos diferentes', () => {
    expect(clockDate({ date: 'jan/02/2024' })).toBe('2024-01-02');
    expect(clockDate({ date: '2026-10-14' })).toBe('2026-10-14');
    expect(normalizeLogTime('10:11:12', '2026-10-14')).toBe('2026-10-14 10:11:12');
    expect(normalizeLogTime('oct/13 23:00:00', '2026-10-14')).toBe('2026-10-13 23:00:00');
    expect(normalizeLogTime('dec/31 23:00:00', '2026-01-02')).toBe('2025-12-31 23:00:00');
    expect(normalizeLogTime('jan/02/2023 10:00:00', '2026-10-14')).toBe('2023-01-02 10:00:00');
    expect(normalizeLogTime('2026-10-13 08:00:00', null)).toBe('2026-10-13 08:00:00');
  });

  it('filtro de logs por tópico, conteúdo e período', () => {
    const rows = [
      { time: '2026-10-13 23:00:00', topics: 'system,info', message: 'router rebooted' },
      { time: '09:59:00', topics: 'pppoe,ppp,info', message: 'joao: authenticated' },
    ];
    const clock = { date: '2026-10-14' };
    expect(filterLogs(rows, clock, { topic: 'pppoe' }).rows).toHaveLength(1);
    expect(filterLogs(rows, clock, { q: 'REBOOT' }).rows[0].message).toBe('router rebooted');
    expect(filterLogs(rows, clock, { from: '2026-10-14T00:00' }).rows).toHaveLength(1);
    expect(filterLogs(rows, clock, {}).topics).toEqual(['info', 'ppp', 'pppoe', 'system']);
  });
});

describe('segurança', () => {
  it('cifra e decifra segredos; rejeita chave errada', () => {
    const a = new SecretBox(Buffer.alloc(32, 1));
    const b = new SecretBox(Buffer.alloc(32, 2));
    const enc = a.encrypt('senha-do-roteador');
    expect(enc).not.toContain('senha');
    expect(a.decrypt(enc)).toBe('senha-do-roteador');
    expect(() => b.decrypt(enc)).toThrow();
  });

  it('hash de senha de usuário', async () => {
    const h = await hashPassword('Abcdef12345');
    expect(await verifyPassword('Abcdef12345', h)).toBe(true);
    expect(await verifyPassword('errada', h)).toBe(false);
  });

  it('remove campos secretos das respostas do roteador', () => {
    expect(stripSecrets({ name: 'a', password: 'x', 'private-key': 'k', 'preshared-key': 'p', 'ipsec-secret': 's', 'public-key': 'pub' }))
      .toEqual({ name: 'a', 'public-key': 'pub' });
  });

  it('auditoria nunca grava senhas', () => {
    expect(sanitize({ name: 'joao', password: 'x', nested: { senha: 'y', ok: 1 } })).toEqual({ name: 'joao', password: '[omitido]', nested: { senha: '[omitido]', ok: 1 } });
  });

  it('permissões efetivas por perfil e ajustes', () => {
    const esc = effectivePermissions('escritorio', ['pppoe.create'], []);
    expect(esc.has('pppoe.view')).toBe(true);
    expect(esc.has('pppoe.create')).toBe(true);
    expect(esc.has('pppoe.password')).toBe(false);
    expect(esc.has('devices.manage')).toBe(false);
    const tec = effectivePermissions('tecnico', [], ['pppoe.disconnect']);
    expect(tec.has('pppoe.disconnect')).toBe(false);
    expect(effectivePermissions('admin', [], ['users.manage']).has('users.manage')).toBe(true);
  });

  it('ordem de métodos prioriza TLS e só usa texto puro se liberado', () => {
    expect(methodOrder({ api_method: 'auto', allow_plaintext: false, detected_method: null })).toEqual(['api-ssl', 'rest']);
    expect(methodOrder({ api_method: 'auto', allow_plaintext: true, detected_method: 'rest' })).toEqual(['rest', 'api-ssl', 'api']);
    expect(methodOrder({ api_method: 'api', allow_plaintext: true, detected_method: null })).toEqual(['api']);
  });
});

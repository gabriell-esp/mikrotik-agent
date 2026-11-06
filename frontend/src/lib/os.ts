import { useEffect, useState } from 'react';

type Tone = 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'purple';

export const OS_STATUS: Record<string, { label: string; color: Tone; accent: 'green' | 'red' | 'amber' | 'slate' | 'blue' }> = {
  aberta: { label: 'Aberta', color: 'slate', accent: 'slate' },
  em_andamento: { label: 'Em andamento', color: 'blue', accent: 'blue' },
  pausada: { label: 'Pausada', color: 'amber', accent: 'amber' },
  concluida: { label: 'Concluída', color: 'green', accent: 'green' },
  cancelada: { label: 'Cancelada', color: 'red', accent: 'red' },
};

export const OS_PRIORITY: Record<string, { label: string; color: Tone }> = {
  baixa: { label: 'Baixa', color: 'slate' },
  normal: { label: 'Normal', color: 'slate' },
  alta: { label: 'Alta', color: 'amber' },
  urgente: { label: 'Urgente', color: 'red' },
};

export const osNumber = (id: number) => `OS #${String(id).padStart(4, '0')}`;

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtMoney = (v: number | null | undefined) => (v == null ? '—' : money.format(v));

/** Cronômetro no formato 1:02:03. */
export function fmtClock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Tempo trabalhado ao vivo: acumulado + período em andamento (avança a cada segundo). */
export function useWorkSeconds(o: { work_seconds: number; running_since: string | null } | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!o?.running_since) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [o?.running_since]);
  if (!o) return 0;
  return o.work_seconds + (o.running_since ? Math.max(0, (now - new Date(o.running_since).getTime()) / 1000) : 0);
}

/** "AAAA-MM-DDTHH:MM" local para o <input type="datetime-local"> e de volta para ISO. */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

async function draw(file: File, max: number, quality: number): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions).catch(() => null);
  const src: CanvasImageSource & { width: number; height: number } = bmp ?? (await new Promise<HTMLImageElement>((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error('Não foi possível ler a imagem.'));
    img.src = URL.createObjectURL(file);
  }));
  const scale = Math.min(1, max / Math.max(src.width, src.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(src.width * scale);
  canvas.height = Math.round(src.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  bmp?.close();
  // Regravar em JPEG descarta os metadados da câmera (inclusive a localização GPS).
  return canvas.toDataURL('image/jpeg', quality).split(',')[1]!;
}

/** Reduz a foto no próprio aparelho (lado maior 1600 px) e gera a miniatura. */
export async function preparePhoto(file: File) {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name}: não é uma imagem.`);
  const [image, thumb] = await Promise.all([draw(file, 1600, 0.82), draw(file, 400, 0.7)]);
  return { image, thumb };
}

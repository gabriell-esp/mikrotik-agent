import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, KeyRound, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Avatar from '../components/Avatar';
import { Button, Card, ErrorBox, Field, Input, PageHeader, PageSkeleton, useToast } from '../components/ui';
import { del, get, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';
import { fmtPhone } from '../lib/os';

/** Recorta o centro da foto em quadrado de 320 px (JPEG). Regravar descarta os metadados (GPS). */
async function squareAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Escolha uma imagem.');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 320, 320);
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 320, 320);
  bmp.close();
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1]!;
}

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['profile'], queryFn: () => get('/profile'), meta: { live: false } });
  const [f, setF] = useState({ name: '', email: '', phone: '' });
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (q.data) setF({ name: q.data.name ?? '', email: q.data.email ?? '', phone: q.data.phone ? fmtPhone(q.data.phone) : '' });
  }, [q.data]);

  const after = () => {
    qc.invalidateQueries({ queryKey: ['profile'] });
    qc.invalidateQueries({ queryKey: ['os'] });
    refresh();
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await put('/profile', f);
      toast.ok('Perfil atualizado.');
      after();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      await put('/profile/avatar', { image: await squareAvatar(file) });
      toast.ok('Foto atualizada.');
      after();
    } catch (e) {
      toast.err(e);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };

  const removePhoto = async () => {
    try {
      await del('/profile/avatar');
      after();
    } catch (e) {
      toast.err(e);
    }
  };

  if (q.isLoading) return <PageSkeleton />;
  if (q.error) return <ErrorBox error={q.error} />;
  const p = q.data;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Meu perfil" subtitle="Seus dados aparecem para a equipe nas ordens de serviço." />

      <Card>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
          <div className="relative">
            <Avatar id={user?.id} name={f.name || user?.name} version={user?.avatarUpdatedAt} size="xl" className="shadow-lg ring-4 ring-white" />
            <button
              onClick={() => input.current?.click()}
              className="absolute right-0 bottom-0 flex size-10 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg ring-4 ring-white transition hover:bg-brand-700"
              aria-label="Trocar foto"
            >
              <Camera className="size-5" />
            </button>
            <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
          </div>
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <div className="text-lg font-semibold text-slate-900">{p.name}</div>
            <div className="text-sm text-slate-500">{p.username} · {user?.roleLabel}</div>
            <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
              <Button size="sm" onClick={() => input.current?.click()} loading={uploading}><Camera className="size-4" /> {user?.avatarUpdatedAt ? 'Trocar foto' : 'Adicionar foto'}</Button>
              {user?.avatarUpdatedAt && <Button size="sm" variant="ghost" onClick={removePhoto}><Trash2 className="size-4" /> Remover</Button>}
            </div>
          </div>
        </div>
      </Card>

      <Card title="Dados pessoais">
        <div className="space-y-4">
          <ErrorBox error={error} title="Não foi possível salvar" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" className="sm:col-span-2">
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Field label="Celular / WhatsApp" hint="Usado para a equipe falar com você sobre as ordens.">
              <Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="(49) 99999-0000" />
            </Field>
            <Field label="E-mail">
              <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">Último acesso: {fmtDateTime(p.last_login_at)}</p>
            <Button variant="primary" onClick={save} loading={saving} disabled={f.name.trim().length < 2}>Salvar</Button>
          </div>
        </div>
      </Card>

      <Card title="Segurança">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">Troque sua senha de acesso ao sistema.</p>
          <Link to="/senha" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <KeyRound className="size-4" /> Alterar senha
          </Link>
        </div>
      </Card>
    </div>
  );
}

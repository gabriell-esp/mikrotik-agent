import { Activity, BellRing, Network, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, ErrorBox, Field, Input } from '../components/ui';
import { post } from '../lib/api';
import { useAuth } from '../lib/auth';

const FEATURES = [
  { icon: Activity, text: 'Status real de cada MikroTik, sem abrir o Winbox' },
  { icon: Network, text: 'Usuários PPPoE de cada condomínio, MikroTik por MikroTik' },
  { icon: BellRing, text: 'Alertas de queda e retorno pelo WhatsApp' },
  { icon: ShieldCheck, text: 'Permissões por perfil e auditoria de cada alteração' },
];

export default function LoginPage() {
  const { refresh } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await post('/auth/login', { username, password });
      refresh();
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-slate-950 p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -top-40 -right-40 size-[520px] rounded-full bg-brand-600/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-48 -left-24 size-[420px] rounded-full bg-brand-500/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 font-bold text-white shadow-lg shadow-brand-900/50">S1</div>
          <div className="leading-tight">
            <div className="font-semibold text-white">Slot1 Informática</div>
            <div className="text-sm text-slate-400">Gerência MikroTik</div>
          </div>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold tracking-tight text-white">Toda a rede dos seus clientes em um painel.</h2>
          <ul className="mt-8 space-y-4">
            {FEATURES.map((f) => (
              <li key={f.text} className="flex items-center gap-3 text-slate-300">
                <span className="flex size-9 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10"><f.icon className="size-4 text-brand-400" /></span>
                {f.text}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative text-xs text-slate-500">Acesso restrito à equipe Slot1. Todas as ações são registradas.</div>
      </div>

      <div className="flex items-center justify-center bg-white p-6 sm:p-12">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5">
          <div className="flex items-center gap-3 lg:hidden">
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 font-bold text-white">S1</div>
            <div className="leading-tight">
              <div className="font-semibold text-slate-900">Slot1 Informática</div>
              <div className="text-sm text-slate-500">Gerência MikroTik</div>
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Entrar</h1>
            <p className="mt-1 text-sm text-slate-500">Use seu usuário do sistema.</p>
          </div>
          <ErrorBox error={error} title="Falha no login" />
          <Field label="Usuário">
            <Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required className="h-10" />
          </Field>
          <Field label="Senha">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-10" />
          </Field>
          <Button variant="primary" type="submit" className="h-10 w-full" loading={loading}>Entrar</Button>
        </form>
      </div>
    </div>
  );
}

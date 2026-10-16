import { useState, type FormEvent } from 'react';
import { Button, Card, ErrorBox, Field, Input, Notice, useToast } from '../components/ui';
import { post } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function ChangePasswordPage({ forced }: { forced?: boolean }) {
  const { refresh } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError(new Error('A confirmação não confere com a nova senha.'));
    setLoading(true);
    setError(null);
    try {
      await post('/auth/change-password', { current, password });
      toast.ok('Senha alterada. As outras sessões foram encerradas.');
      setCurrent('');
      setPassword('');
      setConfirm('');
      refresh();
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const form = (
    <form onSubmit={submit} className="space-y-3">
      {forced && <Notice kind="info">Defina uma nova senha para continuar.</Notice>}
      <ErrorBox error={error} title="Não foi possível alterar" />
      <Field label="Senha atual">
        <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </Field>
      <Field label="Nova senha" hint="Mínimo de 10 caracteres, com letras e números.">
        <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      <Field label="Confirmar nova senha">
        <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </Field>
      <Button type="submit" variant="primary" loading={loading}>
        Alterar senha
      </Button>
    </form>
  );

  if (forced) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-900 p-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
          <h1 className="mb-4 font-semibold">Alteração de senha obrigatória</h1>
          {form}
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-md">
      <Card title="Alterar minha senha">{form}</Card>
    </div>
  );
}

-- Perfil do usuário (telefone e foto) e data de desativação (exclusão automática configurável).
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN avatar BYTEA;
ALTER TABLE users ADD COLUMN avatar_updated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN deactivated_at TIMESTAMPTZ;
-- Quem já estava desativado começa a contar agora: nada é excluído de surpresa na atualização.
UPDATE users SET deactivated_at = now() WHERE NOT active;

-- Ordens de serviço: contatos (nome + telefone, ao menos um nas ordens novas), técnico auxiliar
-- e confirmação de finalização de cada técnico.
ALTER TABLE service_orders ADD COLUMN contacts JSONB NOT NULL DEFAULT '[]';
UPDATE service_orders
   SET contacts = jsonb_build_array(jsonb_build_object(
         'name', btrim(regexp_replace(contact, '[0-9()+\- ]{8,}', ' ', 'g'), ' ·-'),
         'phone', regexp_replace(contact, '\D', '', 'g')))
 WHERE contact IS NOT NULL AND btrim(contact) <> '';
ALTER TABLE service_orders DROP COLUMN contact;
ALTER TABLE service_orders ADD COLUMN helper_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE service_orders ADD CONSTRAINT service_orders_helper_check CHECK (helper_id IS NULL OR helper_id <> assigned_to);
ALTER TABLE service_orders ADD COLUMN assigned_done_at TIMESTAMPTZ;
ALTER TABLE service_orders ADD COLUMN helper_done_at TIMESTAMPTZ;
CREATE INDEX service_orders_helper_idx ON service_orders(helper_id, status);

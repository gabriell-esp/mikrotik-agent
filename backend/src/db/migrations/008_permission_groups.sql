-- Grupos de permissões: um conjunto nomeado de permissões aplicado a vários usuários de uma vez.
-- Usuário com grupo(s): a base de permissões passa a ser a soma dos grupos (no lugar do padrão do perfil).
-- Ajustes individuais (concedida/removida) continuam valendo por cima.
CREATE TABLE IF NOT EXISTS permission_groups (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS permission_groups_name_uq ON permission_groups (lower(name));

CREATE TABLE IF NOT EXISTS user_groups (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);
CREATE INDEX IF NOT EXISTS user_groups_group_idx ON user_groups (group_id);

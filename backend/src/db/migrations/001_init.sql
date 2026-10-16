-- Estrutura inicial: usuários, sessões, clientes, equipamentos, peers WireGuard, cache e auditoria.

CREATE TABLE users (
  id                   SERIAL PRIMARY KEY,
  username             TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  email                TEXT,
  password_hash        TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('admin', 'tecnico', 'escritorio')),
  -- Ajustes finos sobre as permissões padrão do perfil.
  permissions_grant    TEXT[] NOT NULL DEFAULT '{}',
  permissions_revoke   TEXT[] NOT NULL DEFAULT '{}',
  -- Acesso a todos os clientes ou somente aos listados em user_clients.
  all_clients          BOOLEAN NOT NULL DEFAULT FALSE,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  failed_logins        INTEGER NOT NULL DEFAULT 0,
  locked_until         TIMESTAMPTZ,
  last_login_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY, -- sha256 do token; o token em si só existe no cookie
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE clients (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  document   TEXT,
  contact    TEXT,
  phone      TEXT,
  email      TEXT,
  notes      TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clients_name_uq ON clients(lower(name));

CREATE TABLE user_clients (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, client_id)
);

CREATE TABLE devices (
  id              SERIAL PRIMARY KEY,
  client_id       INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  is_central      BOOLEAN NOT NULL DEFAULT FALSE,
  host            TEXT NOT NULL,             -- endereço de gerência (normalmente IP do túnel)
  api_method      TEXT NOT NULL DEFAULT 'auto' CHECK (api_method IN ('auto', 'api-ssl', 'rest', 'api')),
  api_ssl_port    INTEGER NOT NULL DEFAULT 8729,
  rest_port       INTEGER NOT NULL DEFAULT 443,
  api_port        INTEGER NOT NULL DEFAULT 8728,
  allow_plaintext BOOLEAN NOT NULL DEFAULT FALSE, -- permite API sem TLS (8728)
  tls_fingerprint TEXT,                         -- SHA-256 do certificado (pinning) opcional
  username        TEXT NOT NULL,
  password_enc    TEXT NOT NULL,                -- AES-256-GCM, chave fora do banco
  notes           TEXT,
  poll_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  -- Estado de gerência (resultado real da última tentativa de conexão)
  status          TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (status IN ('unknown', 'online', 'unreachable', 'auth_failed', 'error')),
  status_message  TEXT,
  detected_method TEXT,
  ros_version     TEXT,
  board_name      TEXT,
  identity        TEXT,
  last_poll_at    TIMESTAMPTZ,
  last_ok_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX devices_single_central ON devices(is_central) WHERE is_central;
CREATE INDEX devices_client_idx ON devices(client_id);

CREATE TABLE device_status_events (
  id        BIGSERIAL PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  status    TEXT NOT NULL,
  message   TEXT
);
CREATE INDEX device_status_events_idx ON device_status_events(device_id, at DESC);

CREATE TABLE wg_peers (
  id                       SERIAL PRIMARY KEY,
  central_device_id        INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  ros_id                   TEXT,
  public_key               TEXT NOT NULL,
  interface                TEXT,
  name                     TEXT,
  comment                  TEXT,
  allowed_address          TEXT,
  endpoint_address         TEXT,
  endpoint_port            INTEGER,
  current_endpoint_address TEXT,
  current_endpoint_port    INTEGER,
  last_handshake_seconds   INTEGER,  -- NULL = nunca houve handshake
  rx_bytes                 BIGINT,
  tx_bytes                 BIGINT,
  disabled                 BOOLEAN NOT NULL DEFAULT FALSE,
  present                  BOOLEAN NOT NULL DEFAULT TRUE, -- ainda existe na central
  device_id                INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  collected_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (central_device_id, public_key)
);
CREATE INDEX wg_peers_device_idx ON wg_peers(device_id);

-- Cache das consultas por módulo; preserva o último resultado bem-sucedido.
CREATE TABLE module_cache (
  device_id      INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  module         TEXT NOT NULL,
  data           JSONB,
  collected_at   TIMESTAMPTZ,      -- coleta bem-sucedida mais recente
  last_error     TEXT,
  last_error_at  TIMESTAMPTZ,
  PRIMARY KEY (device_id, module)
);

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username    TEXT,
  action      TEXT NOT NULL,
  success     BOOLEAN NOT NULL DEFAULT TRUE,
  device_id   INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  device_name TEXT,
  client_id   INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  target      TEXT,
  details     JSONB,
  ip          TEXT
);
CREATE INDEX audit_log_at_idx ON audit_log(at DESC);
CREATE INDEX audit_log_action_idx ON audit_log(action);
CREATE INDEX audit_log_device_idx ON audit_log(device_id);

-- Notificações (WhatsApp via WPPConnect) e momento da última mudança de status.

ALTER TABLE devices ADD COLUMN status_since TIMESTAMPTZ;
UPDATE devices SET status_since = COALESCE(last_poll_at, now());

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_recipients (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  target     TEXT NOT NULL UNIQUE,     -- número (somente dígitos, com DDI) ou ID do grupo
  is_group   BOOLEAN NOT NULL DEFAULT FALSE,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  events     TEXT[] NOT NULL DEFAULT '{}',
  client_ids INTEGER[],                -- NULL = todos os clientes (inclui a central)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Último estado já comunicado por equipamento (evita repetição e oscilação).
CREATE TABLE device_alert_state (
  device_id       INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  notified_status TEXT NOT NULL,
  notified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resource_alerts TEXT[] NOT NULL DEFAULT '{}',
  peer_alerted    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE notification_log (
  id             BIGSERIAL PRIMARY KEY,
  at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  recipient_id   INTEGER REFERENCES notification_recipients(id) ON DELETE SET NULL,
  recipient_name TEXT,
  target         TEXT,
  events         TEXT[] NOT NULL DEFAULT '{}',
  device_ids     INTEGER[] NOT NULL DEFAULT '{}',
  message        TEXT NOT NULL,
  success        BOOLEAN NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 1,
  error          TEXT
);
CREATE INDEX notification_log_at_idx ON notification_log(at DESC);

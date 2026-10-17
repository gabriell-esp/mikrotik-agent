-- Controladoras UniFi (Cloud Key / UniFi Network Application).

CREATE TABLE unifi_controllers (
  id              SERIAL PRIMARY KEY,
  client_id       INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  url             TEXT NOT NULL,                -- ex.: https://10.200.0.5 ou https://10.200.0.5:8443
  username        TEXT NOT NULL,
  password_enc    TEXT NOT NULL,                -- AES-256-GCM, chave fora do banco
  tls_fingerprint TEXT,                         -- SHA-256 do certificado (opcional)
  platform        TEXT,                         -- 'unifios' | 'legacy' (detectado)
  version         TEXT,                         -- versão do Network Application
  notes           TEXT,
  poll_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  status          TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (status IN ('unknown', 'online', 'unreachable', 'auth_failed', 'error')),
  status_message  TEXT,
  status_since    TIMESTAMPTZ,
  last_poll_at    TIMESTAMPTZ,
  last_ok_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX unifi_controllers_client_idx ON unifi_controllers(client_id);
CREATE UNIQUE INDEX unifi_controllers_url_uq ON unifi_controllers(lower(url));

-- Última leitura de cada site (dispositivos, clientes, redes Wi-Fi, saúde).
CREATE TABLE unifi_cache (
  controller_id  INTEGER NOT NULL REFERENCES unifi_controllers(id) ON DELETE CASCADE,
  site           TEXT NOT NULL,
  kind           TEXT NOT NULL,
  data           JSONB,
  collected_at   TIMESTAMPTZ,
  last_error     TEXT,
  last_error_at  TIMESTAMPTZ,
  PRIMARY KEY (controller_id, site, kind)
);

-- Auditoria também por controladora.
ALTER TABLE audit_log ADD COLUMN unifi_controller_id INTEGER REFERENCES unifi_controllers(id) ON DELETE SET NULL;
CREATE INDEX audit_log_unifi_idx ON audit_log(unifi_controller_id);

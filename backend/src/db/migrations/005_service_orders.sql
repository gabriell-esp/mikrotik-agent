-- Ordens de serviço: atribuição a técnicos, tempo trabalhado, relatório, gastos e fotos.

CREATE TABLE service_orders (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT,
  client_id     INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  location      TEXT,
  contact       TEXT,
  priority      TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('baixa', 'normal', 'alta', 'urgente')),
  status        TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'em_andamento', 'pausada', 'concluida', 'cancelada')),
  assigned_to   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  scheduled_for TIMESTAMPTZ,
  report        TEXT,
  cancel_reason TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ
);
CREATE INDEX service_orders_assigned_idx ON service_orders(assigned_to, status);
CREATE INDEX service_orders_status_idx ON service_orders(status, created_at DESC);
CREATE INDEX service_orders_client_idx ON service_orders(client_id);

-- Períodos de trabalho (cronômetro). Período aberto = ended_at NULL; no máximo um por ordem.
CREATE TABLE service_order_time (
  id         BIGSERIAL PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at   TIMESTAMPTZ
);
CREATE INDEX service_order_time_order_idx ON service_order_time(order_id);
CREATE UNIQUE INDEX service_order_time_open_idx ON service_order_time(order_id) WHERE ended_at IS NULL;

-- Gastos: materiais e despesas lançados na ordem.
CREATE TABLE service_order_items (
  id          BIGSERIAL PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'material' CHECK (kind IN ('material', 'despesa')),
  description TEXT NOT NULL,
  quantity    NUMERIC(12, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price  NUMERIC(12, 2) CHECK (unit_price IS NULL OR unit_price >= 0),
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX service_order_items_order_idx ON service_order_items(order_id);

-- Fotos (já reduzidas no navegador). Guardadas no banco para entrar no mesmo backup.
CREATE TABLE service_order_photos (
  id          BIGSERIAL PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  caption     TEXT,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  data        BYTEA NOT NULL,
  thumb       BYTEA NOT NULL,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX service_order_photos_order_idx ON service_order_photos(order_id);

-- Histórico da ordem (linha do tempo exibida na tela).
CREATE TABLE service_order_events (
  id       BIGSERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username TEXT,
  kind     TEXT NOT NULL,
  details  JSONB
);
CREATE INDEX service_order_events_order_idx ON service_order_events(order_id, at);

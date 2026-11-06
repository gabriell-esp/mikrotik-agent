-- Gastos da OS: material (quantidade em unidades ou metros, sem valor) e compra em loja (valor pago).
ALTER TABLE service_order_items DROP CONSTRAINT service_order_items_kind_check;
ALTER TABLE service_order_items ADD COLUMN unit TEXT NOT NULL DEFAULT 'un' CHECK (unit IN ('un', 'm'));
ALTER TABLE service_order_items ADD COLUMN store TEXT;
ALTER TABLE service_order_items ADD COLUMN amount NUMERIC(12, 2) CHECK (amount IS NULL OR amount >= 0);
-- Despesas antigas viram compras com o valor total; materiais deixam de ter valor.
UPDATE service_order_items SET kind = 'compra', amount = quantity * unit_price WHERE kind = 'despesa';
ALTER TABLE service_order_items DROP COLUMN unit_price;
ALTER TABLE service_order_items ADD CONSTRAINT service_order_items_kind_check CHECK (kind IN ('material', 'compra'));

-- Planejamento dos administradores: ordens futuras, orçamentos e lembretes.
CREATE TABLE planner_items (
  id               SERIAL PRIMARY KEY,
  kind             TEXT NOT NULL DEFAULT 'os_futura' CHECK (kind IN ('os_futura', 'orcamento', 'lembrete')),
  title            TEXT NOT NULL,
  notes            TEXT,
  client_id        INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  due_date         DATE,
  priority         TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('baixa', 'normal', 'alta', 'urgente')),
  status           TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aguardando', 'concluido', 'descartado')),
  -- Orçamento: valor estimado/enviado ao cliente.
  amount           NUMERIC(12, 2) CHECK (amount IS NULL OR amount >= 0),
  checklist        JSONB NOT NULL DEFAULT '[]',
  service_order_id INTEGER REFERENCES service_orders(id) ON DELETE SET NULL,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at          TIMESTAMPTZ
);
CREATE INDEX planner_items_status_idx ON planner_items(status, due_date);

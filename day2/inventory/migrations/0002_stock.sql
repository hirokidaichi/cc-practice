-- Migration 0002: stock levels, inventory movements (append-only history),
-- and FIFO cost layers. stock_levels is variant x location; cost_layers is
-- variant x warehouse (intra-warehouse moves must not split layers).

CREATE TABLE stock_levels (
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  on_hand_qty INTEGER NOT NULL DEFAULT 0 CHECK (on_hand_qty >= 0),
  reserved_qty INTEGER NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  available_qty INTEGER GENERATED ALWAYS AS (on_hand_qty - reserved_qty) STORED,
  last_movement_at TEXT,
  PRIMARY KEY (variant_id, location_id),
  CHECK (reserved_qty <= on_hand_qty)
);

CREATE INDEX idx_stock_available ON stock_levels(location_id, available_qty);

CREATE TABLE inventory_movements (
  id INTEGER PRIMARY KEY,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN
    ('inbound', 'outbound', 'reserve', 'release', 'adjustment', 'transfer_out', 'transfer_in')),
  qty INTEGER NOT NULL,
  unit_cost INTEGER,
  ref_type TEXT,
  ref_id INTEGER,
  note TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_movements_variant_time ON inventory_movements(variant_id, occurred_at);
CREATE INDEX idx_movements_ref ON inventory_movements(ref_type, ref_id);
CREATE INDEX idx_movements_location ON inventory_movements(location_id, occurred_at);

CREATE TABLE cost_layers (
  id INTEGER PRIMARY KEY,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  received_at TEXT NOT NULL,
  unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
  initial_qty INTEGER NOT NULL CHECK (initial_qty > 0),
  remaining_qty INTEGER NOT NULL CHECK (remaining_qty >= 0),
  receipt_line_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_cost_layers_fifo ON cost_layers(variant_id, warehouse_id, received_at, id)

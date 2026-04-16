-- Migration 0004: sales orders + order line allocations
-- 状態機械: pending → confirmed → shipped → delivered / cancelled
-- confirmed 時点で sales_order_lines を bundle_components に展開して
-- order_line_allocations (variant × location 粒度) を作る。
-- shipped 時点で allocations を元に cost_layers を FIFO 消費する。

CREATE TABLE sales_orders (
  id INTEGER PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled')),
  subtotal_amount INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
  discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  ordered_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT,
  shipped_at TEXT,
  delivered_at TEXT,
  cancelled_at TEXT,
  note TEXT
);

CREATE INDEX idx_orders_status ON sales_orders(status, ordered_at);
CREATE INDEX idx_orders_customer ON sales_orders(customer_id, ordered_at);
CREATE INDEX idx_orders_warehouse ON sales_orders(warehouse_id);

CREATE TABLE sales_order_lines (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  line_discount INTEGER NOT NULL DEFAULT 0 CHECK (line_discount >= 0),
  captured_unit_cost INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_order_lines_order ON sales_order_lines(order_id);
CREATE INDEX idx_order_lines_variant ON sales_order_lines(variant_id);

CREATE TABLE order_line_allocations (
  id INTEGER PRIMARY KEY,
  order_line_id INTEGER NOT NULL REFERENCES sales_order_lines(id) ON DELETE CASCADE,
  component_variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  allocated_qty INTEGER NOT NULL CHECK (allocated_qty > 0),
  consumed_cost INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_alloc_line ON order_line_allocations(order_line_id);
CREATE INDEX idx_alloc_variant ON order_line_allocations(component_variant_id);
CREATE INDEX idx_alloc_location ON order_line_allocations(location_id)

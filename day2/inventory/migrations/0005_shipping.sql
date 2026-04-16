-- Migration 0005: shipments + shipment_lines.
-- MVP: 1 注文 = 1 shipment。shipment status は
--   prepared → shipped → in_transit → delivered (または returned)。

CREATE TABLE shipments (
  id INTEGER PRIMARY KEY,
  shipment_number TEXT NOT NULL UNIQUE,
  order_id INTEGER NOT NULL REFERENCES sales_orders(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  carrier TEXT,
  tracking_number TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('prepared', 'shipped', 'in_transit', 'delivered', 'returned')),
  shipped_at TEXT,
  delivered_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_shipments_order ON shipments(order_id);
CREATE INDEX idx_shipments_status ON shipments(status);

CREATE TABLE shipment_lines (
  id INTEGER PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  order_line_id INTEGER NOT NULL REFERENCES sales_order_lines(id),
  qty INTEGER NOT NULL CHECK (qty > 0)
);

CREATE INDEX idx_shipment_lines_shipment ON shipment_lines(shipment_id)

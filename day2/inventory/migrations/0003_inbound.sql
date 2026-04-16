-- Migration 0003: inbound (goods receipts) tables.
-- purchase_orders は MVP 外。goods_receipts だけで仕入れ入庫を完結させる。

CREATE TABLE goods_receipts (
  id INTEGER PRIMARY KEY,
  receipt_number TEXT NOT NULL UNIQUE,
  supplier_id INTEGER REFERENCES suppliers(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  received_at TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_receipts_warehouse ON goods_receipts(warehouse_id);
CREATE INDEX idx_receipts_received_at ON goods_receipts(received_at);

CREATE TABLE goods_receipt_lines (
  id INTEGER PRIMARY KEY,
  receipt_id INTEGER NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0)
);

CREATE INDEX idx_receipt_lines_receipt ON goods_receipt_lines(receipt_id);
CREATE INDEX idx_receipt_lines_variant ON goods_receipt_lines(variant_id)

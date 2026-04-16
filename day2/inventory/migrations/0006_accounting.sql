-- Migration 0006: general-ledger append-only entries.
-- Shipment service がここに Sales / COGS / AR / Inventory を記帳する。
-- accounting module 本体のレポート/集計は Step 17 で追加予定。

CREATE TABLE gl_entries (
  id INTEGER PRIMARY KEY,
  entry_date TEXT NOT NULL,
  account TEXT NOT NULL CHECK (account IN ('sales', 'cogs', 'inventory', 'discount', 'ar', 'cash')),
  debit INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
  ref_type TEXT,
  ref_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_gl_date_account ON gl_entries(entry_date, account);
CREATE INDEX idx_gl_ref ON gl_entries(ref_type, ref_id)

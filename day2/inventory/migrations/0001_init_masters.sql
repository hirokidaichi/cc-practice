-- Migration 0001: master data tables
-- products/variants/bundle_components 3-layer model, warehouses + locations hierarchy,
-- plus suppliers, customers, categories.

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_categories_parent ON categories(parent_id);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_products_category ON products(category_id);

CREATE TABLE product_variants (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT NOT NULL UNIQUE,
  variant_type TEXT NOT NULL CHECK (variant_type IN ('simple', 'bundle')),
  attributes TEXT,
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  standard_cost INTEGER NOT NULL DEFAULT 0 CHECK (standard_cost >= 0),
  barcode TEXT UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_variants_product ON product_variants(product_id);
CREATE INDEX idx_variants_type ON product_variants(variant_type);

CREATE TABLE bundle_components (
  bundle_variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  component_variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bundle_variant_id, component_variant_id)
);

CREATE INDEX idx_bundle_component_ref ON bundle_components(component_variant_id);

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact_email TEXT,
  lead_time_days INTEGER DEFAULT 0 CHECK (lead_time_days >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  shipping_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE warehouses (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE locations (
  id INTEGER PRIMARY KEY,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  parent_location_id INTEGER REFERENCES locations(id),
  code TEXT NOT NULL,
  full_path TEXT NOT NULL,
  location_type TEXT NOT NULL CHECK (location_type IN ('zone', 'aisle', 'rack', 'shelf', 'bin')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_locations_warehouse_path ON locations(warehouse_id, full_path);
CREATE INDEX idx_locations_parent ON locations(parent_location_id);
CREATE INDEX idx_locations_warehouse ON locations(warehouse_id)

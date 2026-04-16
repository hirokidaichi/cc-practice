import type { Row } from "@libsql/client";
import type { DbExecutor } from "../../shared/db/tx.js";
import type {
	Attributes,
	BundleComponent,
	BundleComponentDetail,
	CreateVariantInput,
	ListVariantsOpts,
	UpdateVariantInput,
	Variant,
	VariantType,
} from "./schema.js";

function parseAttributes(raw: unknown): Attributes | null {
	if (raw === null || raw === undefined) return null;
	const text = String(raw);
	if (text === "") return null;
	try {
		const parsed = JSON.parse(text);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Attributes;
		}
		return null;
	} catch {
		return null;
	}
}

function rowToVariant(row: Row): Variant {
	return {
		id: Number(row.id),
		productId: Number(row.product_id),
		sku: String(row.sku),
		variantType: String(row.variant_type) as VariantType,
		attributes: parseAttributes(row.attributes),
		unitPrice: Number(row.unit_price),
		standardCost: Number(row.standard_cost),
		barcode: row.barcode === null || row.barcode === undefined ? null : String(row.barcode),
		isActive: Number(row.is_active) === 1,
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
	};
}

export function createVariantRepository(db: DbExecutor) {
	return {
		async create(
			productId: number,
			input: Omit<CreateVariantInput, "productCode">,
		): Promise<number> {
			const rs = await db.execute({
				sql: `INSERT INTO product_variants
				        (product_id, sku, variant_type, attributes, unit_price, standard_cost, barcode)
				      VALUES (?, ?, ?, ?, ?, ?, ?)
				      RETURNING id`,
				args: [
					productId,
					input.sku,
					input.variantType,
					input.attributes ? JSON.stringify(input.attributes) : null,
					input.unitPrice,
					input.standardCost,
					input.barcode ?? null,
				],
			});
			const row = rs.rows[0];
			if (!row) throw new Error("INSERT product_variants did not return id");
			return Number(row.id);
		},

		async findById(id: number): Promise<Variant | null> {
			const rs = await db.execute({
				sql: "SELECT * FROM product_variants WHERE id = ?",
				args: [id],
			});
			const row = rs.rows[0];
			return row ? rowToVariant(row) : null;
		},

		async findBySku(sku: string): Promise<Variant | null> {
			const rs = await db.execute({
				sql: "SELECT * FROM product_variants WHERE sku = ?",
				args: [sku],
			});
			const row = rs.rows[0];
			return row ? rowToVariant(row) : null;
		},

		async list(opts: ListVariantsOpts): Promise<{ items: Variant[]; total: number }> {
			const clauses: string[] = [];
			const args: (string | number)[] = [];
			if (opts.productCode) {
				clauses.push("product_id = (SELECT id FROM products WHERE code = ?)");
				args.push(opts.productCode);
			}
			if (opts.skuPrefix) {
				clauses.push("sku LIKE ?");
				args.push(`${opts.skuPrefix}%`);
			}
			if (opts.variantType) {
				clauses.push("variant_type = ?");
				args.push(opts.variantType);
			}
			if (!opts.includeInactive) clauses.push("is_active = 1");
			const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

			const itemsRs = await db.execute({
				sql: `SELECT * FROM product_variants ${where} ORDER BY id ASC LIMIT ? OFFSET ?`,
				args: [...args, opts.limit, opts.offset],
			});
			const countRs = await db.execute({
				sql: `SELECT COUNT(*) AS c FROM product_variants ${where}`,
				args,
			});
			return {
				items: itemsRs.rows.map(rowToVariant),
				total: Number(countRs.rows[0]?.c ?? 0),
			};
		},

		async update(id: number, patch: UpdateVariantInput): Promise<void> {
			const sets: string[] = [];
			const args: (string | number | null)[] = [];
			if (patch.unitPrice !== undefined) {
				sets.push("unit_price = ?");
				args.push(patch.unitPrice);
			}
			if (patch.standardCost !== undefined) {
				sets.push("standard_cost = ?");
				args.push(patch.standardCost);
			}
			if (patch.attributes !== undefined) {
				sets.push("attributes = ?");
				args.push(patch.attributes === null ? null : JSON.stringify(patch.attributes));
			}
			if (patch.barcode !== undefined) {
				sets.push("barcode = ?");
				args.push(patch.barcode);
			}
			if (sets.length === 0) return;
			sets.push("updated_at = datetime('now')");
			args.push(id);
			await db.execute({
				sql: `UPDATE product_variants SET ${sets.join(", ")} WHERE id = ?`,
				args,
			});
		},

		async setActive(id: number, active: boolean): Promise<void> {
			await db.execute({
				sql: "UPDATE product_variants SET is_active = ?, updated_at = datetime('now') WHERE id = ?",
				args: [active ? 1 : 0, id],
			});
		},

		async upsertBundleComponent(
			bundleVariantId: number,
			componentVariantId: number,
			qty: number,
			sortOrder: number,
		): Promise<void> {
			await db.execute({
				sql: `INSERT INTO bundle_components
				        (bundle_variant_id, component_variant_id, qty, sort_order)
				      VALUES (?, ?, ?, ?)
				      ON CONFLICT (bundle_variant_id, component_variant_id)
				      DO UPDATE SET qty = excluded.qty, sort_order = excluded.sort_order`,
				args: [bundleVariantId, componentVariantId, qty, sortOrder],
			});
		},

		async removeBundleComponent(
			bundleVariantId: number,
			componentVariantId: number,
		): Promise<number> {
			const rs = await db.execute({
				sql: "DELETE FROM bundle_components WHERE bundle_variant_id = ? AND component_variant_id = ?",
				args: [bundleVariantId, componentVariantId],
			});
			return rs.rowsAffected;
		},

		async listBundleComponentsRaw(bundleVariantId: number): Promise<BundleComponent[]> {
			const rs = await db.execute({
				sql: `SELECT bundle_variant_id, component_variant_id, qty, sort_order
				      FROM bundle_components
				      WHERE bundle_variant_id = ?
				      ORDER BY sort_order ASC, component_variant_id ASC`,
				args: [bundleVariantId],
			});
			return rs.rows.map((r) => ({
				bundleVariantId: Number(r.bundle_variant_id),
				componentVariantId: Number(r.component_variant_id),
				qty: Number(r.qty),
				sortOrder: Number(r.sort_order),
			}));
		},

		async listBundleComponentsDetailed(bundleVariantId: number): Promise<BundleComponentDetail[]> {
			const rs = await db.execute({
				sql: `SELECT bc.bundle_variant_id,
				             bc.component_variant_id,
				             bc.qty,
				             bc.sort_order,
				             v.sku AS component_sku,
				             p.name AS component_name
				      FROM bundle_components bc
				      JOIN product_variants v ON v.id = bc.component_variant_id
				      JOIN products p ON p.id = v.product_id
				      WHERE bc.bundle_variant_id = ?
				      ORDER BY bc.sort_order ASC, bc.component_variant_id ASC`,
				args: [bundleVariantId],
			});
			return rs.rows.map((r) => ({
				bundleVariantId: Number(r.bundle_variant_id),
				componentVariantId: Number(r.component_variant_id),
				qty: Number(r.qty),
				sortOrder: Number(r.sort_order),
				componentSku: String(r.component_sku),
				componentName: String(r.component_name),
			}));
		},

		async nextBundleSortOrder(bundleVariantId: number): Promise<number> {
			const rs = await db.execute({
				sql: "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM bundle_components WHERE bundle_variant_id = ?",
				args: [bundleVariantId],
			});
			return Number(rs.rows[0]?.next ?? 0);
		},
	};
}

export type VariantRepository = ReturnType<typeof createVariantRepository>;

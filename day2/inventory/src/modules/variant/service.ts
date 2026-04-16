import type { DbClient } from "../../shared/db/client.js";
import { withTransaction } from "../../shared/db/tx.js";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors/domain-error.js";
import { createProductRepository } from "../product/repository.js";
import { createVariantRepository } from "./repository.js";
import type {
	BundleComponentDetail,
	CreateVariantInput,
	ExpandedLine,
	ListVariantsOpts,
	UpdateVariantInput,
	Variant,
} from "./schema.js";

export class VariantService {
	constructor(private readonly db: DbClient) {}

	async create(input: CreateVariantInput): Promise<Variant> {
		return withTransaction(this.db, async (tx) => {
			const productRepo = createProductRepository(tx);
			const variantRepo = createVariantRepository(tx);

			const product = await productRepo.findByCode(input.productCode);
			if (!product) throw new NotFoundError("product", input.productCode);
			if (!product.isActive) {
				throw new ConflictError(`product is archived: ${input.productCode}`);
			}

			const existing = await variantRepo.findBySku(input.sku);
			if (existing) {
				throw new ConflictError(`variant sku already exists: ${input.sku}`, { sku: input.sku });
			}

			const id = await variantRepo.create(product.id, {
				sku: input.sku,
				variantType: input.variantType,
				unitPrice: input.unitPrice,
				standardCost: input.standardCost,
				...(input.attributes !== undefined ? { attributes: input.attributes } : {}),
				...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
			});
			const created = await variantRepo.findById(id);
			if (!created) throw new Error("failed to reload created variant");
			return created;
		});
	}

	async findBySku(sku: string): Promise<Variant | null> {
		const repo = createVariantRepository(this.db);
		return repo.findBySku(sku);
	}

	async requireBySku(sku: string): Promise<Variant> {
		const v = await this.findBySku(sku);
		if (!v) throw new NotFoundError("variant", sku);
		return v;
	}

	async findById(id: number): Promise<Variant | null> {
		const repo = createVariantRepository(this.db);
		return repo.findById(id);
	}

	async requireById(id: number): Promise<Variant> {
		const v = await this.findById(id);
		if (!v) throw new NotFoundError("variant", id);
		return v;
	}

	async list(opts: ListVariantsOpts): Promise<{ items: Variant[]; total: number }> {
		const repo = createVariantRepository(this.db);
		return repo.list(opts);
	}

	async update(sku: string, patch: UpdateVariantInput): Promise<Variant> {
		return withTransaction(this.db, async (tx) => {
			const repo = createVariantRepository(tx);
			const existing = await repo.findBySku(sku);
			if (!existing) throw new NotFoundError("variant", sku);
			await repo.update(existing.id, patch);
			const updated = await repo.findById(existing.id);
			if (!updated) throw new Error("failed to reload updated variant");
			return updated;
		});
	}

	async archive(sku: string): Promise<Variant> {
		return withTransaction(this.db, async (tx) => {
			const repo = createVariantRepository(tx);
			const existing = await repo.findBySku(sku);
			if (!existing) throw new NotFoundError("variant", sku);
			if (!existing.isActive) return existing;
			await repo.setActive(existing.id, false);
			const updated = await repo.findById(existing.id);
			if (!updated) throw new Error("failed to reload archived variant");
			return updated;
		});
	}

	async unarchive(sku: string): Promise<Variant> {
		return withTransaction(this.db, async (tx) => {
			const repo = createVariantRepository(tx);
			const existing = await repo.findBySku(sku);
			if (!existing) throw new NotFoundError("variant", sku);
			if (existing.isActive) return existing;
			await repo.setActive(existing.id, true);
			const updated = await repo.findById(existing.id);
			if (!updated) throw new Error("failed to reload unarchived variant");
			return updated;
		});
	}

	// -- bundle operations --

	async defineBundleComponent(params: {
		bundleSku: string;
		componentSku: string;
		qty: number;
	}): Promise<BundleComponentDetail[]> {
		if (params.qty <= 0) throw new ValidationError("qty must be positive");
		return withTransaction(this.db, async (tx) => {
			const repo = createVariantRepository(tx);
			const bundle = await repo.findBySku(params.bundleSku);
			if (!bundle) throw new NotFoundError("bundle variant", params.bundleSku);
			if (bundle.variantType !== "bundle") {
				throw new ValidationError(`variant is not a bundle: ${params.bundleSku}`, {
					variantType: bundle.variantType,
				});
			}
			const component = await repo.findBySku(params.componentSku);
			if (!component) throw new NotFoundError("component variant", params.componentSku);
			if (component.variantType !== "simple") {
				throw new ValidationError(
					`component must be a simple variant (nested bundles are not supported): ${params.componentSku}`,
				);
			}
			if (component.id === bundle.id) {
				throw new ValidationError("bundle cannot contain itself");
			}

			const sortOrder = await repo.nextBundleSortOrder(bundle.id);
			await repo.upsertBundleComponent(bundle.id, component.id, params.qty, sortOrder);
			return repo.listBundleComponentsDetailed(bundle.id);
		});
	}

	async removeBundleComponent(params: {
		bundleSku: string;
		componentSku: string;
	}): Promise<BundleComponentDetail[]> {
		return withTransaction(this.db, async (tx) => {
			const repo = createVariantRepository(tx);
			const bundle = await repo.findBySku(params.bundleSku);
			if (!bundle) throw new NotFoundError("bundle variant", params.bundleSku);
			if (bundle.variantType !== "bundle") {
				throw new ValidationError(`variant is not a bundle: ${params.bundleSku}`);
			}
			const component = await repo.findBySku(params.componentSku);
			if (!component) throw new NotFoundError("component variant", params.componentSku);
			const removed = await repo.removeBundleComponent(bundle.id, component.id);
			if (removed === 0) {
				throw new NotFoundError("bundle component", `${params.bundleSku}/${params.componentSku}`);
			}
			return repo.listBundleComponentsDetailed(bundle.id);
		});
	}

	async listBundleComponents(bundleSku: string): Promise<BundleComponentDetail[]> {
		const repo = createVariantRepository(this.db);
		const bundle = await repo.findBySku(bundleSku);
		if (!bundle) throw new NotFoundError("bundle variant", bundleSku);
		if (bundle.variantType !== "bundle") {
			throw new ValidationError(`variant is not a bundle: ${bundleSku}`);
		}
		return repo.listBundleComponentsDetailed(bundle.id);
	}

	async expandBundle(variantId: number, qty: number): Promise<ExpandedLine[]> {
		if (qty <= 0) throw new ValidationError("qty must be positive");
		const variant = await this.requireById(variantId);

		if (variant.variantType === "simple") {
			return [
				{
					variantId: variant.id,
					sku: variant.sku,
					perBundleQty: 1,
					totalRequiredQty: qty,
				},
			];
		}

		const repo = createVariantRepository(this.db);
		const components = await repo.listBundleComponentsDetailed(variant.id);
		if (components.length === 0) {
			throw new ValidationError(`bundle has no components defined: ${variant.sku}`, {
				bundleSku: variant.sku,
			});
		}
		return components.map((c) => ({
			variantId: c.componentVariantId,
			sku: c.componentSku,
			perBundleQty: c.qty,
			totalRequiredQty: c.qty * qty,
		}));
	}

	async getBundleAvailability(bundleVariantId: number, warehouseId: number): Promise<number> {
		const variant = await this.requireById(bundleVariantId);
		if (variant.variantType !== "bundle") {
			throw new ValidationError(`variant is not a bundle: ${variant.sku}`);
		}
		const rs = await this.db.execute({
			sql: `SELECT bc.component_variant_id,
			             bc.qty AS per_bundle_qty,
			             COALESCE(SUM(sl.available_qty), 0) AS available_qty
			      FROM bundle_components bc
			      LEFT JOIN stock_levels sl ON sl.variant_id = bc.component_variant_id
			      LEFT JOIN locations l ON l.id = sl.location_id AND l.warehouse_id = ?
			      WHERE bc.bundle_variant_id = ?
			      GROUP BY bc.component_variant_id, bc.qty`,
			args: [warehouseId, bundleVariantId],
		});

		if (rs.rows.length === 0) return 0;

		let minBundles = Number.POSITIVE_INFINITY;
		for (const row of rs.rows) {
			const perBundle = Number(row.per_bundle_qty);
			const available = Number(row.available_qty);
			// locations JOIN drops rows whose warehouse filter failed, so the LEFT JOIN
			// can still return 0 via COALESCE when a component has no stock in the warehouse.
			const possible = perBundle > 0 ? Math.floor(available / perBundle) : 0;
			if (possible < minBundles) minBundles = possible;
		}
		return minBundles === Number.POSITIVE_INFINITY ? 0 : minBundles;
	}
}

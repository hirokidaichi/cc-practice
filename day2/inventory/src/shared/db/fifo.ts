import { ConflictError, ValidationError } from "../errors/domain-error.js";
import type { DbExecutor } from "./tx.js";

export interface FifoConsumption {
	layerId: number;
	consumedQty: number;
	unitCost: number;
}

export interface FifoConsumeResult {
	consumptions: FifoConsumption[];
	totalConsumedQty: number;
	totalCost: number;
	weightedAvgCost: number;
}

export interface PushCostLayerArgs {
	variantId: number;
	warehouseId: number;
	receivedAt: string;
	unitCost: number;
	qty: number;
	receiptLineId?: number;
}

export async function pushCostLayer(tx: DbExecutor, args: PushCostLayerArgs): Promise<number> {
	if (args.qty <= 0) throw new ValidationError("qty must be positive for cost layer");
	const rs = await tx.execute({
		sql: `INSERT INTO cost_layers
		        (variant_id, warehouse_id, received_at, unit_cost, initial_qty, remaining_qty, receipt_line_id)
		      VALUES (?, ?, ?, ?, ?, ?, ?)
		      RETURNING id`,
		args: [
			args.variantId,
			args.warehouseId,
			args.receivedAt,
			args.unitCost,
			args.qty,
			args.qty,
			args.receiptLineId ?? null,
		],
	});
	const row = rs.rows[0];
	if (!row) throw new Error("INSERT cost_layers did not return id");
	return Number(row.id);
}

export interface ConsumeCostLayersArgs {
	variantId: number;
	warehouseId: number;
	qty: number;
}

export async function consumeCostLayers(
	tx: DbExecutor,
	args: ConsumeCostLayersArgs,
): Promise<FifoConsumeResult> {
	if (args.qty <= 0) throw new ValidationError("qty must be positive for consume");

	const rs = await tx.execute({
		sql: `SELECT id, unit_cost, remaining_qty
		      FROM cost_layers
		      WHERE variant_id = ? AND warehouse_id = ? AND remaining_qty > 0
		      ORDER BY received_at ASC, id ASC`,
		args: [args.variantId, args.warehouseId],
	});

	let needed = args.qty;
	const consumptions: FifoConsumption[] = [];
	let totalCost = 0;

	for (const row of rs.rows) {
		if (needed <= 0) break;
		const layerId = Number(row.id);
		const unitCost = Number(row.unit_cost);
		const remaining = Number(row.remaining_qty);
		const take = Math.min(needed, remaining);
		await tx.execute({
			sql: "UPDATE cost_layers SET remaining_qty = remaining_qty - ? WHERE id = ?",
			args: [take, layerId],
		});
		consumptions.push({ layerId, consumedQty: take, unitCost });
		totalCost += take * unitCost;
		needed -= take;
	}

	if (needed > 0) {
		throw new ConflictError(
			`insufficient cost-layer stock: variant_id=${args.variantId} warehouse_id=${args.warehouseId} short=${needed}`,
			{ variantId: args.variantId, warehouseId: args.warehouseId, short: needed },
		);
	}

	const weightedAvgCost = Math.floor(totalCost / args.qty);
	return {
		consumptions,
		totalConsumedQty: args.qty,
		totalCost,
		weightedAvgCost,
	};
}

export async function sumRemainingQty(
	tx: DbExecutor,
	variantId: number,
	warehouseId: number,
): Promise<number> {
	const rs = await tx.execute({
		sql: `SELECT COALESCE(SUM(remaining_qty), 0) AS s
		      FROM cost_layers
		      WHERE variant_id = ? AND warehouse_id = ?`,
		args: [variantId, warehouseId],
	});
	return Number(rs.rows[0]?.s ?? 0);
}

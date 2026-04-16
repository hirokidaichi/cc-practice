# inv — libSQL + TypeScript CLI 在庫管理システム

cc-practice の学習用サブプロジェクト。商品/バリアント/バンドルの 3 層モデル、複数倉庫 + ロケーション階層、FIFO 原価を扱う CLI 在庫管理ツール。

## セットアップ

```bash
npm install
cp .env.example .env

npm run db:migrate   # ローカル SQLite ファイルにマイグレーション適用
npm run dev -- --help
```

## スクリプト

| script | 用途 |
| --- | --- |
| `npm run dev` | tsx で CLI を直接実行（開発用） |
| `npm run build` | TypeScript を dist/ にビルド |
| `npm start` | dist/ のビルド成果物を実行 |
| `npm test` | Vitest（ユニット + 統合） |
| `npm run lint` | Biome で lint チェック |
| `npm run typecheck` | tsc --noEmit |
| `npm run db:migrate` | マイグレーション適用 |

## 設計ドキュメント

詳細設計は `~/.claude/plans/dreamy-splashing-squirrel.md` を参照。

- 商品 / バリアント / バンドルの 3 層モデル
- 複数倉庫 + ロケーション階層 (zone → aisle → rack → shelf → bin)
- FIFO 原価レイヤー (variant × warehouse 粒度)
- append-only な `inventory_movements` / `gl_entries`

import { defineConfig } from "vitest/config";

/**
 * Vitest 設定（改訂版仕様書 7: core 相当モジュールの単体テスト）。
 * - DOM は不要な純関数モジュールのみ対象（environment: node）
 * - vite.config.ts（アプリ本体のビルド設定）とは分離してテストを高速化する
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    reporters: ["default"],
  },
});

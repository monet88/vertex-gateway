import fs from "node:fs";
import path from "node:path";
import { readJsonIfExists, writeJsonAtomic } from "../lib/json-file-store.js";
import type { AdminStoreMode, GatewayConfig } from "./env.js";

const SETTINGS_FILE = "admin-settings.json";

interface AdminFileStoreSettings {
  adminToken?: string | null;
}

const settingsPath = (dir: string): string => path.join(dir, SETTINGS_FILE);

export const loadAdminFileStoreSettings = (
  adminStoreMode: AdminStoreMode,
  adminFileStoreDir: string | null,
): Partial<Pick<GatewayConfig, "adminToken">> => {
  if (adminStoreMode !== "file-store" || !adminFileStoreDir) return {};
  const settings = readJsonIfExists(settingsPath(adminFileStoreDir)) as AdminFileStoreSettings | null;
  const adminToken = typeof settings?.adminToken === "string" ? settings.adminToken.trim() : "";
  return adminToken ? { adminToken } : {};
};

export const canBootstrapAdminToken = (config: GatewayConfig): boolean =>
  config.enableAdminRoutes
  && !config.adminToken
  && config.adminStoreMode === "file-store"
  && config.adminAllowMutations
  && Boolean(config.adminFileStoreDir);

export const persistAdminFileStoreSettings = (
  config: GatewayConfig,
  settings: AdminFileStoreSettings,
): void => {
  if (config.adminStoreMode !== "file-store" || !config.adminFileStoreDir) {
    throw new Error("Admin file-store settings are not configured.");
  }
  fs.mkdirSync(config.adminFileStoreDir, { recursive: true, mode: 0o700 });
  const filePath = settingsPath(config.adminFileStoreDir);
  const current = readJsonIfExists(filePath) ?? {};
  writeJsonAtomic(filePath, { ...current, ...settings });
};

import path from 'node:path';
import type { GatewayConfig } from '../config/env.js';
import {
  persistAdminFileStoreSettings,
  readAdminFileStoreSettings,
} from '../config/admin-settings-store.js';
import { GatewayError } from '../http/error-response.js';

export interface DiagnosticsFlags {
  debugMode: boolean;
  logToFile: boolean;
}

export const isDiagnosticsWritable = (config: GatewayConfig): boolean =>
  config.adminStoreMode === 'file-store'
  && config.adminAllowMutations
  && Boolean(config.adminFileStoreDir);

export const resolveApiCallLogFilePath = (config: GatewayConfig): string | null => {
  if (!config.adminFileStoreDir) return null;
  return path.join(config.adminFileStoreDir, 'logs', 'api-calls.log');
};

export const isDiagnosticsGateEnabled = (flags: DiagnosticsFlags): boolean =>
  flags.debugMode && flags.logToFile;

export const readDiagnosticsFlags = (config: GatewayConfig): DiagnosticsFlags => {
  const settings = readAdminFileStoreSettings(config);
  return {
    debugMode: settings.debugMode === true,
    logToFile: settings.logToFile === true,
  };
};

export const writeDiagnosticsFlags = (
  config: GatewayConfig,
  patch: Partial<DiagnosticsFlags>,
): DiagnosticsFlags => {
  if (!isDiagnosticsWritable(config)) {
    throw new GatewayError(409, 'VALIDATION_FAILED', 'Diagnostics settings are not writable.');
  }
  const current = readDiagnosticsFlags(config);
  const next: DiagnosticsFlags = {
    debugMode: typeof patch.debugMode === 'boolean' ? patch.debugMode : current.debugMode,
    logToFile: typeof patch.logToFile === 'boolean' ? patch.logToFile : current.logToFile,
  };
  persistAdminFileStoreSettings(config, {
    debugMode: next.debugMode,
    logToFile: next.logToFile,
  });
  return next;
};

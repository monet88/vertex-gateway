import fs from "node:fs";
import { loadServiceAccountCredential } from "../auth/google-auth.js";

export type VertexPoolSelection = "round-robin" | "weighted-round-robin";
export type AdminStoreMode = "static-config" | "file-store";
export type GatewayRuntimeMode = "single" | "pool";

export interface VertexPoolConfig {
  id: string;
  label?: string;
  project: string;
  location: string;
  credentialsFile: string | null;
  apiKey: string | null;
  enabled: boolean;
  weight: number;
  modelAllowlist: string[];
  modelExclusions: string[];
}

export interface ProviderModelCatalog {
  defaultModel?: string;
  aliases: Record<string, string>;
  allowlist: string[];
  disabled: string[];
}

export interface ResolvedVertexTargetConfig extends VertexPoolConfig {
  source: "legacy" | "pool";
}

export interface GatewayConfig {
  port: number;
  gatewayKeys: string[];
  corsOrigins: string[];
  allowWildcardCors: boolean;
  googleProject: string;
  googleLocation: string;
  googleCredentialsFile: string | null;
  googleApiKey: string | null;
  googleApiVersion: string;
  maxJsonBytes: number;
  maxImages: number;
  maxDecodedImageBytes: number;
  upstreamTimeoutMs: number;
  upstreamConcurrency: number;
  streamMaxDurationMs: number;
  streamIdleTimeoutMs: number;
  streamPerKeyLimit: number;
  streamQueueLimit: number;
  vertexPoolFailoverCooldownMs: number;
  enableGeminiRoutes: boolean;
  enableOpenAiRoutes: boolean;
  enableVertexRoutes: boolean;
  enableVtxRoutes: boolean;
  enableImageRoutes: boolean;
  runtimeMode: GatewayRuntimeMode;
  vertexPoolSelection: VertexPoolSelection;
  vertexPools: VertexPoolConfig[];
  resolvedVertexTargets: ResolvedVertexTargetConfig[];
  modelCatalog: Record<string, ProviderModelCatalog>;
  enableAdminRoutes: boolean;
  adminToken: string | null;
  adminAllowMutations: boolean;
  adminStoreMode: AdminStoreMode;
  adminFileStoreDir: string | null;
}

const DEFAULTS = {
  port: 8080,
  googleLocation: "us-central1",
  googleApiVersion: "v1",
  maxJsonBytes: 8 * 1024 * 1024,
  maxImages: 4,
  maxDecodedImageBytes: 6 * 1024 * 1024,
  upstreamTimeoutMs: 45_000,
  upstreamConcurrency: 4,
  streamMaxDurationMs: 240_000,
  streamIdleTimeoutMs: 30_000,
  streamPerKeyLimit: 2,
  streamQueueLimit: 4,
  vertexPoolFailoverCooldownMs: 60_000,
  vertexPoolSelection: "weighted-round-robin" as VertexPoolSelection,
  adminStoreMode: "static-config" as AdminStoreMode,
};

const splitList = (value: string | undefined): string[] =>
  value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) ?? [];

type GatewayFileConfig = Partial<{
  port: number;
  gatewayKeys: string[];
  corsOrigins: string[];
  allowWildcardCors: boolean;
  googleProject: string;
  googleLocation: string;
  googleCredentialsFile: string | null;
  googleApiKey: string | null;
  googleApiVersion: string;
  maxJsonBytes: number;
  maxImages: number;
  maxDecodedImageBytes: number;
  upstreamTimeoutMs: number;
  upstreamConcurrency: number;
  streamMaxDurationMs: number;
  streamIdleTimeoutMs: number;
  streamPerKeyLimit: number;
  streamQueueLimit: number;
  vertexPoolFailoverCooldownMs: number;
  enableGeminiRoutes: boolean;
  enableOpenAiRoutes: boolean;
  enableVertexRoutes: boolean;
  enableVtxRoutes: boolean;
  enableImageRoutes: boolean;
}>;

type GatewayPoolOverlayConfig = Partial<{
  vertexPoolSelection: VertexPoolSelection;
  vertexPoolFailoverCooldownMs: number;
  vertexPools: VertexPoolConfig[];
  modelCatalog: Record<string, ProviderModelCatalog>;
  enableAdminRoutes: boolean;
  adminToken: string | null;
  adminAllowMutations: boolean;
  adminStoreMode: AdminStoreMode;
  adminFileStoreDir: string | null;
}>;

const parseQuotedScalar = (trimmed: string): string => {
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed.slice(1, -1);
};

const normalizeScalar = (value: string): string | number | boolean | null => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return parseQuotedScalar(trimmed);
  }
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && /^-?\d+(\.\d+)?$/.test(trimmed)
    ? numeric
    : trimmed;
};

const isEscapedQuote = (line: string, quoteIndex: number): boolean => {
  let backslashes = 0;
  for (
    let index = quoteIndex - 1;
    index >= 0 && line[index] === "\\";
    index -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
};

const stripYamlComment = (line: string): string => {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' || char === "'") {
      if (quote === null) {
        quote = char;
        continue;
      }
      if (quote === char && (char !== '"' || !isEscapedQuote(line, index))) {
        quote = null;
      }
      continue;
    }
    if (char === "#" && quote === null) {
      return line.slice(0, index);
    }
  }
  return line;
};

const assertStringArray = (
  config: Record<string, unknown>,
  key: string,
  filePath: string,
): void => {
  const value = config[key];
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid ${filePath}: ${key} must be a string array.`);
  }
};

const validateStringRecord = (
  value: unknown,
  key: string,
  filePath: string,
): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Invalid ${filePath}: ${key} must be an object of string values.`,
    );
  }
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== "string") {
      throw new Error(
        `Invalid ${filePath}: ${key}.${entryKey} must be a string.`,
      );
    }
  }
  return value as Record<string, string>;
};

const assertString = (
  config: Record<string, unknown>,
  key: string,
  filePath: string,
): void => {
  const value = config[key];
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`Invalid ${filePath}: ${key} must be a string.`);
  }
};

const assertNullableString = (
  config: Record<string, unknown>,
  key: string,
  filePath: string,
): void => {
  const value = config[key];
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new Error(`Invalid ${filePath}: ${key} must be a string or null.`);
  }
};

const assertPositiveNumber = (
  config: Record<string, unknown>,
  key: string,
  filePath: string,
): void => {
  const value = config[key];
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${filePath}: ${key} must be a positive number.`);
  }
};

const assertBoolean = (
  config: Record<string, unknown>,
  key: string,
  filePath: string,
): void => {
  const value = config[key];
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`Invalid ${filePath}: ${key} must be a boolean.`);
  }
};

const asObject = (
  value: unknown,
  filePath: string,
): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${filePath}: expected a JSON object.`);
  }
  return value as Record<string, unknown>;
};

const validateProviderModelCatalog = (
  provider: string,
  value: unknown,
  filePath: string,
): ProviderModelCatalog => {
  const config = asObject(value, filePath);
  const defaultModel = config.defaultModel;
  if (defaultModel !== undefined && typeof defaultModel !== "string") {
    throw new Error(
      `Invalid ${filePath}: modelCatalog.${provider}.defaultModel must be a string.`,
    );
  }
  const aliases =
    config.aliases !== undefined
      ? validateStringRecord(
          config.aliases,
          `modelCatalog.${provider}.aliases`,
          filePath,
        )
      : undefined;
  if (config.allowlist !== undefined) {
    assertStringArray(
      config,
      "allowlist",
      `${filePath}:modelCatalog.${provider}`,
    );
  }
  if (config.disabled !== undefined) {
    assertStringArray(
      config,
      "disabled",
      `${filePath}:modelCatalog.${provider}`,
    );
  }
  return {
    ...(typeof defaultModel === "string" ? { defaultModel } : {}),
    aliases: aliases ?? {},
    allowlist: (config.allowlist as string[] | undefined) ?? [],
    disabled: (config.disabled as string[] | undefined) ?? [],
  };
};

const validateVertexPoolEntry = (
  entry: unknown,
  index: number,
  filePath: string,
): VertexPoolConfig => {
  const config = asObject(entry, filePath);
  const prefix = `vertexPools[${index}]`;
  for (const key of ["id", "project", "location"]) {
    assertString(config, key, `${filePath}:${prefix}`);
  }
  assertNullableString(config, "credentialsFile", `${filePath}:${prefix}`);
  assertNullableString(config, "apiKey", `${filePath}:${prefix}`);
  assertBoolean(config, "enabled", `${filePath}:${prefix}`);
  assertPositiveNumber(config, "weight", `${filePath}:${prefix}`);
  if (config.modelAllowlist !== undefined) {
    assertStringArray(config, "modelAllowlist", `${filePath}:${prefix}`);
  }
  if (config.modelExclusions !== undefined) {
    assertStringArray(config, "modelExclusions", `${filePath}:${prefix}`);
  }
  const id = (config.id as string | undefined)?.trim();
  const project = (config.project as string | undefined)?.trim();
  const location = (config.location as string | undefined)?.trim();
  if (!id) throw new Error(`Invalid ${filePath}:${prefix}: id is required.`);
  if (!project)
    throw new Error(`Invalid ${filePath}:${prefix}: project is required.`);
  if (!location)
    throw new Error(`Invalid ${filePath}:${prefix}: location is required.`);
  return {
    id,
    ...(typeof config.label === "string" && config.label.trim()
      ? { label: config.label.trim() }
      : {}),
    project,
    location,
    credentialsFile:
      typeof config.credentialsFile === "string"
        ? config.credentialsFile.trim()
        : null,
    apiKey:
      typeof config.apiKey === "string" && config.apiKey.trim()
        ? config.apiKey.trim()
        : null,
    enabled: config.enabled !== undefined ? Boolean(config.enabled) : true,
    weight: Number(config.weight ?? 1),
    modelAllowlist: (config.modelAllowlist as string[] | undefined) ?? [],
    modelExclusions: (config.modelExclusions as string[] | undefined) ?? [],
  };
};

const validateFileConfig = (
  config: Record<string, unknown>,
  filePath: string,
): GatewayFileConfig => {
  assertStringArray(config, "gatewayKeys", filePath);
  assertStringArray(config, "corsOrigins", filePath);
  for (const key of ["googleProject", "googleLocation", "googleApiVersion"]) {
    assertString(config, key, filePath);
  }
  assertNullableString(config, "googleCredentialsFile", filePath);
  assertNullableString(config, "googleApiKey", filePath);
  for (const key of [
    "port",
    "maxJsonBytes",
    "maxImages",
    "maxDecodedImageBytes",
    "upstreamTimeoutMs",
    "upstreamConcurrency",
    "streamMaxDurationMs",
    "streamIdleTimeoutMs",
    "streamPerKeyLimit",
    "streamQueueLimit",
    "vertexPoolFailoverCooldownMs",
  ]) {
    assertPositiveNumber(config, key, filePath);
  }
  for (const key of [
    "allowWildcardCors",
    "enableGeminiRoutes",
    "enableOpenAiRoutes",
    "enableVertexRoutes",
    "enableVtxRoutes",
    "enableImageRoutes",
  ]) {
    assertBoolean(config, key, filePath);
  }
  for (const nestedKey of [
    "vertexPools",
    "modelCatalog",
    "enableAdminRoutes",
    "adminToken",
    "adminAllowMutations",
    "adminStoreMode",
    "adminFileStoreDir",
    "vertexPoolSelection",
  ]) {
    if (nestedKey in config) {
      throw new Error(
        `Invalid ${filePath}: ${nestedKey} must be configured via GATEWAY_POOL_CONFIG_FILE.`,
      );
    }
  }
  return config as GatewayFileConfig;
};

const validatePoolOverlayConfig = (
  config: Record<string, unknown>,
  filePath: string,
): GatewayPoolOverlayConfig => {
  const normalized: GatewayPoolOverlayConfig = {};
  if (config.vertexPoolSelection !== undefined) {
    if (
      config.vertexPoolSelection !== "round-robin" &&
      config.vertexPoolSelection !== "weighted-round-robin"
    ) {
      throw new Error(
        `Invalid ${filePath}: vertexPoolSelection must be "round-robin" or "weighted-round-robin".`,
      );
    }
    normalized.vertexPoolSelection = config.vertexPoolSelection;
  }
  if (config.vertexPoolFailoverCooldownMs !== undefined) {
    if (
      typeof config.vertexPoolFailoverCooldownMs !== "number" ||
      !Number.isFinite(config.vertexPoolFailoverCooldownMs) ||
      config.vertexPoolFailoverCooldownMs <= 0
    ) {
      throw new Error(
        `Invalid ${filePath}: vertexPoolFailoverCooldownMs must be a positive number.`,
      );
    }
    normalized.vertexPoolFailoverCooldownMs =
      config.vertexPoolFailoverCooldownMs;
  }
  if (config.vertexPools !== undefined) {
    if (!Array.isArray(config.vertexPools)) {
      throw new Error(`Invalid ${filePath}: vertexPools must be an array.`);
    }
    normalized.vertexPools = config.vertexPools.map((entry, index) =>
      validateVertexPoolEntry(entry, index, filePath),
    );
  }
  if (config.modelCatalog !== undefined) {
    const modelCatalog = asObject(config.modelCatalog, filePath);
    normalized.modelCatalog = Object.fromEntries(
      Object.entries(modelCatalog).map(([provider, value]) => [
        provider,
        validateProviderModelCatalog(provider, value, filePath),
      ]),
    );
  }
  for (const key of ["enableAdminRoutes", "adminAllowMutations"]) {
    assertBoolean(config, key, filePath);
  }
  assertNullableString(config, "adminToken", filePath);
  if (
    config.adminStoreMode !== undefined &&
    config.adminStoreMode !== "static-config" &&
    config.adminStoreMode !== "file-store"
  ) {
    throw new Error(
      `Invalid ${filePath}: adminStoreMode must be "static-config" or "file-store".`,
    );
  }
  assertNullableString(config, "adminFileStoreDir", filePath);
  normalized.enableAdminRoutes = config.enableAdminRoutes as
    | boolean
    | undefined;
  normalized.adminToken = config.adminToken as string | null | undefined;
  normalized.adminAllowMutations = config.adminAllowMutations as
    | boolean
    | undefined;
  normalized.adminStoreMode = config.adminStoreMode as
    | AdminStoreMode
    | undefined;
  normalized.adminFileStoreDir = config.adminFileStoreDir as
    | string
    | null
    | undefined;
  return normalized;
};

const loadJsonObjectFile = (filePath: string): Record<string, unknown> => {
  const source = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(source);
  return asObject(parsed, filePath);
};

const loadFileConfig = (): GatewayFileConfig => {
  const filePath = process.env.GATEWAY_CONFIG_FILE?.trim();
  if (!filePath) return {};
  if (filePath.endsWith(".json")) {
    return validateFileConfig(loadJsonObjectFile(filePath), filePath);
  }

  const source = fs.readFileSync(filePath, "utf8");
  const config: Record<string, unknown> = {};
  let currentListKey: string | null = null;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripYamlComment(rawLine);
    if (!line.trim()) continue;

    const listItem = line.match(/^\s*-\s*(.+?)\s*$/);
    if (listItem && currentListKey) {
      const value = normalizeScalar(listItem[1]);
      const list = Array.isArray(config[currentListKey])
        ? (config[currentListKey] as unknown[])
        : [];
      list.push(String(value));
      config[currentListKey] = list;
      continue;
    }

    const entry = line.match(/^([A-Za-z0-9]+):\s*(.*)$/);
    if (!entry) {
      throw new Error(
        `Invalid ${filePath}: unsupported line "${rawLine.trim()}"`,
      );
    }

    const [, key, rawValue] = entry;
    if (!rawValue.trim()) {
      config[key] = [];
      currentListKey = key;
      continue;
    }

    config[key] = normalizeScalar(rawValue);
    currentListKey = null;
  }

  return validateFileConfig(config, filePath);
};

const loadPoolOverlayConfig = (): GatewayPoolOverlayConfig => {
  const filePath = process.env.GATEWAY_POOL_CONFIG_FILE?.trim();
  if (!filePath) return {};
  if (!filePath.endsWith(".json")) {
    throw new Error(
      `Invalid ${filePath}: GATEWAY_POOL_CONFIG_FILE must point to a JSON file.`,
    );
  }
  return validatePoolOverlayConfig(loadJsonObjectFile(filePath), filePath);
};

const parseVertexPoolsEnv = (): VertexPoolConfig[] => {
  const raw = process.env.VERTEX_POOLS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const firstColon = entry.indexOf(":");
      const secondColon = entry.indexOf(":", firstColon + 1);
      if (firstColon === -1 || secondColon === -1) {
        throw new Error(
          `Invalid VERTEX_POOLS entry #${index + 1} "${entry}": expected format "project:location:apiKey".`,
        );
      }
      const project = entry.slice(0, firstColon).trim();
      const location = entry.slice(firstColon + 1, secondColon).trim();
      const apiKey = entry.slice(secondColon + 1).trim();
      if (!project || !location || !apiKey) {
        throw new Error(
          `Invalid VERTEX_POOLS entry #${index + 1}: project, location, and apiKey are all required.`,
        );
      }
      return {
        id: `env-${project}`,
        label: `${project} (env)`,
        project,
        location,
        credentialsFile: null,
        apiKey,
        enabled: true,
        weight: 1,
        modelAllowlist: [],
        modelExclusions: [],
      };
    });
};

const boolEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};

const numberEnv = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${name}: expected a positive number.`);
  }
  return value;
};

const normalizeModelCatalog = (
  modelCatalog: Record<string, ProviderModelCatalog> | undefined,
): Record<string, ProviderModelCatalog> =>
  Object.fromEntries(
    Object.entries(modelCatalog ?? {}).map(([provider, config]) => [
      provider,
      {
        ...(config.defaultModel ? { defaultModel: config.defaultModel } : {}),
        aliases: { ...config.aliases },
        allowlist: [...config.allowlist],
        disabled: [...config.disabled],
      },
    ]),
  );

const resolveVertexTargets = (
  config: GatewayConfig,
): ResolvedVertexTargetConfig[] => {
  if (config.vertexPools.length > 0) {
    return config.vertexPools
      .filter((entry) => entry.enabled)
      .map((entry) => ({ ...entry, source: "pool" as const }));
  }

  return [
    {
      id: "legacy-default",
      label: "Legacy default",
      project: config.googleProject,
      location: config.googleLocation,
      credentialsFile: config.googleCredentialsFile,
      apiKey: config.googleApiKey,
      enabled: true,
      weight: 1,
      modelAllowlist: [],
      modelExclusions: [],
      source: "legacy",
    },
  ];
};

export const loadConfig = (): GatewayConfig => {
  const fileConfig = loadFileConfig();
  const poolOverlay = loadPoolOverlayConfig();
  const envPools = (poolOverlay.vertexPools?.length ?? 0) > 0
    ? []
    : parseVertexPoolsEnv();
  const googleProject = (
    process.env.GOOGLE_VERTEX_PROJECT ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCLOUD_PROJECT ??
    fileConfig.googleProject ??
    ""
  ).trim();

  const config: GatewayConfig = {
    port: numberEnv("PORT", fileConfig.port ?? DEFAULTS.port),
    gatewayKeys:
      splitList(process.env.GATEWAY_API_KEYS).length > 0
        ? splitList(process.env.GATEWAY_API_KEYS)
        : (fileConfig.gatewayKeys ?? []),
    corsOrigins:
      splitList(process.env.GATEWAY_CORS_ORIGINS).length > 0
        ? splitList(process.env.GATEWAY_CORS_ORIGINS)
        : (fileConfig.corsOrigins ?? []),
    allowWildcardCors: boolEnv(
      process.env.GATEWAY_ALLOW_WILDCARD_CORS,
      fileConfig.allowWildcardCors ?? false,
    ),
    googleProject,
    googleLocation:
      process.env.GOOGLE_VERTEX_LOCATION?.trim() ||
      fileConfig.googleLocation ||
      DEFAULTS.googleLocation,
    googleCredentialsFile:
      process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
      fileConfig.googleCredentialsFile ||
      null,
    googleApiKey:
      process.env.GOOGLE_GENAI_API_KEY?.trim() ||
      fileConfig.googleApiKey ||
      null,
    googleApiVersion:
      process.env.GOOGLE_GENAI_API_VERSION?.trim() ||
      fileConfig.googleApiVersion ||
      DEFAULTS.googleApiVersion,
    maxJsonBytes: numberEnv(
      "GATEWAY_MAX_JSON_BYTES",
      fileConfig.maxJsonBytes ?? DEFAULTS.maxJsonBytes,
    ),
    maxImages: numberEnv(
      "GATEWAY_MAX_IMAGES",
      fileConfig.maxImages ?? DEFAULTS.maxImages,
    ),
    maxDecodedImageBytes: numberEnv(
      "GATEWAY_MAX_DECODED_IMAGE_BYTES",
      fileConfig.maxDecodedImageBytes ?? DEFAULTS.maxDecodedImageBytes,
    ),
    upstreamTimeoutMs: numberEnv(
      "GATEWAY_UPSTREAM_TIMEOUT_MS",
      fileConfig.upstreamTimeoutMs ?? DEFAULTS.upstreamTimeoutMs,
    ),
    upstreamConcurrency: numberEnv(
      "GATEWAY_UPSTREAM_CONCURRENCY",
      fileConfig.upstreamConcurrency ?? DEFAULTS.upstreamConcurrency,
    ),
    streamMaxDurationMs: numberEnv(
      "GATEWAY_STREAM_MAX_DURATION_MS",
      fileConfig.streamMaxDurationMs ?? DEFAULTS.streamMaxDurationMs,
    ),
    streamIdleTimeoutMs: numberEnv(
      "GATEWAY_STREAM_IDLE_TIMEOUT_MS",
      fileConfig.streamIdleTimeoutMs ?? DEFAULTS.streamIdleTimeoutMs,
    ),
    streamPerKeyLimit: numberEnv(
      "GATEWAY_STREAM_PER_KEY_LIMIT",
      fileConfig.streamPerKeyLimit ?? DEFAULTS.streamPerKeyLimit,
    ),
    streamQueueLimit: numberEnv(
      "GATEWAY_STREAM_QUEUE_LIMIT",
      fileConfig.streamQueueLimit ?? DEFAULTS.streamQueueLimit,
    ),
    vertexPoolFailoverCooldownMs: numberEnv(
      "GATEWAY_VERTEX_POOL_FAILOVER_COOLDOWN_MS",
      poolOverlay.vertexPoolFailoverCooldownMs ??
        fileConfig.vertexPoolFailoverCooldownMs ??
        DEFAULTS.vertexPoolFailoverCooldownMs,
    ),
    enableGeminiRoutes: boolEnv(
      process.env.GATEWAY_ENABLE_GEMINI_ROUTES,
      fileConfig.enableGeminiRoutes ?? true,
    ),
    enableOpenAiRoutes: boolEnv(
      process.env.GATEWAY_ENABLE_OPENAI_ROUTES,
      fileConfig.enableOpenAiRoutes ?? true,
    ),
    enableVertexRoutes: boolEnv(
      process.env.GATEWAY_ENABLE_VERTEX_ROUTES,
      fileConfig.enableVertexRoutes ?? true,
    ),
    enableVtxRoutes: boolEnv(
      process.env.GATEWAY_ENABLE_VTX_ROUTES,
      fileConfig.enableVtxRoutes ?? true,
    ),
    enableImageRoutes: boolEnv(
      process.env.GATEWAY_ENABLE_IMAGE_ROUTES,
      fileConfig.enableImageRoutes ?? true,
    ),
    runtimeMode:
      (poolOverlay.vertexPools?.length ?? 0) > 0 || envPools.length > 0
        ? "pool"
        : "single",
    vertexPoolSelection:
      (process.env.GATEWAY_VERTEX_POOL_SELECTION?.trim() as
        | VertexPoolSelection
        | undefined) ||
      poolOverlay.vertexPoolSelection ||
      DEFAULTS.vertexPoolSelection,
    vertexPools:
      (poolOverlay.vertexPools?.length ?? 0) > 0
        ? poolOverlay.vertexPools!
        : envPools,
    resolvedVertexTargets: [],
    modelCatalog: normalizeModelCatalog(poolOverlay.modelCatalog),
    enableAdminRoutes: boolEnv(
      process.env.GATEWAY_ENABLE_ADMIN_ROUTES,
      poolOverlay.enableAdminRoutes ?? false,
    ),
    adminToken:
      process.env.GATEWAY_ADMIN_TOKEN?.trim() || poolOverlay.adminToken || null,
    adminAllowMutations: boolEnv(
      process.env.GATEWAY_ADMIN_ALLOW_MUTATIONS,
      poolOverlay.adminAllowMutations ?? false,
    ),
    adminStoreMode:
      (process.env.GATEWAY_ADMIN_STORE_MODE?.trim() as
        | AdminStoreMode
        | undefined) ||
      poolOverlay.adminStoreMode ||
      DEFAULTS.adminStoreMode,
    adminFileStoreDir:
      process.env.GATEWAY_ADMIN_FILE_STORE_DIR?.trim() ||
      poolOverlay.adminFileStoreDir ||
      null,
  };

  config.resolvedVertexTargets = resolveVertexTargets(config);
  validateConfig(config);
  return config;
};

export const createDerivedConfig = (
  config: GatewayConfig,
  overrides: Partial<
    Pick<
      GatewayConfig,
      "vertexPools" | "modelCatalog" | "runtimeMode" | "resolvedVertexTargets"
    >
  >,
): GatewayConfig => {
  const nextConfig: GatewayConfig = {
    ...config,
    ...(overrides.vertexPools
      ? { vertexPools: overrides.vertexPools.map((entry) => ({ ...entry })) }
      : {}),
    ...(overrides.modelCatalog
      ? { modelCatalog: normalizeModelCatalog(overrides.modelCatalog) }
      : {}),
    runtimeMode: overrides.vertexPools
      ? overrides.vertexPools.length > 0
        ? "pool"
        : "single"
      : (overrides.runtimeMode ?? config.runtimeMode),
    resolvedVertexTargets: [],
  };
  nextConfig.resolvedVertexTargets = overrides.resolvedVertexTargets
    ? overrides.resolvedVertexTargets.map((entry) => ({ ...entry }))
    : resolveVertexTargets(nextConfig);
  validateConfig(nextConfig);
  return nextConfig;
};

export const validateConfig = (config: GatewayConfig): void => {
  if (config.gatewayKeys.length === 0)
    throw new Error("GATEWAY_API_KEYS is required.");
  if (
    config.vertexPoolSelection !== "round-robin" &&
    config.vertexPoolSelection !== "weighted-round-robin"
  ) {
    throw new Error(
      'GATEWAY_VERTEX_POOL_SELECTION must be "round-robin" or "weighted-round-robin".',
    );
  }
  if (
    config.adminStoreMode !== "static-config" &&
    config.adminStoreMode !== "file-store"
  ) {
    throw new Error(
      'GATEWAY_ADMIN_STORE_MODE must be "static-config" or "file-store".',
    );
  }
  if (config.enableAdminRoutes && !config.adminToken) {
    throw new Error(
      "GATEWAY_ADMIN_TOKEN is required when admin routes are enabled.",
    );
  }
  if (config.adminToken && config.gatewayKeys.includes(config.adminToken)) {
    throw new Error(
      "GATEWAY_ADMIN_TOKEN must not overlap with GATEWAY_API_KEYS.",
    );
  }
  if (
    config.adminStoreMode === "file-store" &&
    config.adminAllowMutations &&
    !config.adminFileStoreDir
  ) {
    throw new Error(
      "GATEWAY_ADMIN_FILE_STORE_DIR is required when file-store mutations are enabled.",
    );
  }
  if (
    process.env.K_SERVICE &&
    config.adminStoreMode === "file-store" &&
    config.adminAllowMutations
  ) {
    throw new Error(
      "Cloud Run does not support admin file-store mutations in this MVP.",
    );
  }

  if (config.vertexPools.length > 0) {
    const seenIds = new Set<string>();
    for (const entry of config.vertexPools) {
      if (!entry.id.trim()) {
        throw new Error("Vertex pool id is required.");
      }
      if (!entry.project.trim() || !entry.location.trim()) {
        throw new Error(
          `Vertex pool ${entry.id} must include non-empty project and location.`,
        );
      }
      if (entry.weight <= 0) {
        throw new Error(
          `Vertex pool ${entry.id} must include a positive weight.`,
        );
      }
      if (seenIds.has(entry.id)) {
        throw new Error(`Duplicate vertex pool id: ${entry.id}`);
      }
      seenIds.add(entry.id);
      if (entry.credentialsFile) {
        loadServiceAccountCredential(entry.credentialsFile);
      }
      if (entry.enabled && !entry.credentialsFile && !entry.apiKey) {
        throw new Error(
          `Vertex pool ${entry.id} must include either credentialsFile or apiKey.`,
        );
      }
    }
    if (config.resolvedVertexTargets.length === 0) {
      throw new Error("At least one enabled vertex pool target is required.");
    }
    return;
  }

  const serviceAccount = loadServiceAccountCredential(
    config.googleCredentialsFile,
  );
  if (
    !config.googleApiKey &&
    !config.googleProject &&
    !serviceAccount?.project_id
  ) {
    throw new Error(
      "GOOGLE_VERTEX_PROJECT, GOOGLE_CLOUD_PROJECT, or service account project_id is required (or set GOOGLE_GENAI_API_KEY for express mode).",
    );
  }
  if (!config.googleLocation)
    throw new Error("GOOGLE_VERTEX_LOCATION is required.");
};

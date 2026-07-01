import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);

let packageRoot = process.cwd();
let tools = process.platform === 'win32' ? ['vitest.cmd', 'tsc.cmd'] : [];

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--package-root') {
    const value = args[index + 1];
    if (!value) {
      throw new Error('Missing value for --package-root');
    }
    packageRoot = path.resolve(process.cwd(), value);
    index += 1;
    continue;
  }
  if (arg === '--tools') {
    const value = args[index + 1];
    if (!value) {
      throw new Error('Missing value for --tools');
    }
    tools = value.split(',').map((entry) => entry.trim()).filter(Boolean);
    index += 1;
  }
}

const exists = (relativePath) => fs.existsSync(path.join(packageRoot, relativePath));

const existsInAncestors = (relativePath) => {
  let currentDir = packageRoot;
  while (true) {
    if (fs.existsSync(path.join(currentDir, relativePath))) {
      return true;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return false;
    }
    currentDir = parentDir;
  }
};

const issues = [];
const warnings = [];

const platformTargets = {
  win32: {
    x64: {
      rollup: 'node_modules/@rollup/rollup-win32-x64-msvc',
      esbuild: 'node_modules/@esbuild/win32-x64',
    },
    arm64: {
      rollup: 'node_modules/@rollup/rollup-win32-arm64-msvc',
      esbuild: 'node_modules/@esbuild/win32-arm64',
    },
  },
  linux: {
    x64: {
      rollup: 'node_modules/@rollup/rollup-linux-x64-gnu',
      esbuild: 'node_modules/@esbuild/linux-x64',
    },
    arm64: {
      rollup: 'node_modules/@rollup/rollup-linux-arm64-gnu',
      esbuild: 'node_modules/@esbuild/linux-arm64',
    },
  },
};

const currentTarget = platformTargets[process.platform]?.[process.arch];

if (!exists('node_modules')) {
  issues.push(`Missing node_modules under ${path.relative(process.cwd(), packageRoot) || '.'}. Run npm install for this OS before starting dev/build/test flows.`);
}

if (!currentTarget) {
  warnings.push(`No explicit native dependency check is configured for ${process.platform}/${process.arch}.`);
} else {
  if (!existsInAncestors(currentTarget.rollup)) {
    issues.push(`Missing Rollup native package for ${process.platform}/${process.arch}: ${currentTarget.rollup}`);
  }
  if (!existsInAncestors(currentTarget.esbuild)) {
    issues.push(`Missing esbuild native package for ${process.platform}/${process.arch}: ${currentTarget.esbuild}`);
  }
}

if (process.platform === 'win32') {
  const missingWindowsShims = tools
    .filter((name) => !exists(path.join('node_modules', '.bin', name)));
  if (missingWindowsShims.length > 0) {
    issues.push(`Missing Windows command shims under node_modules/.bin: ${missingWindowsShims.join(', ')}`);
  }

  const linuxNativeArtifacts = [
    'node_modules/@rollup/rollup-linux-x64-gnu',
    'node_modules/@rollup/rollup-linux-x64-musl',
    'node_modules/@esbuild/linux-x64',
  ].filter(exists);
  if (linuxNativeArtifacts.length > 0) {
    warnings.push(`Detected Linux-native packages in this Windows checkout: ${linuxNativeArtifacts.join(', ')}`);
  }
}

if (process.platform === 'linux') {
  const windowsArtifacts = [
    'node_modules/.bin/vitest.cmd',
    'node_modules/.bin/eslint.cmd',
    'node_modules/.bin/tsc.cmd',
    'node_modules/@rollup/rollup-win32-x64-msvc',
    'node_modules/@esbuild/win32-x64',
  ].filter(exists);
  if (windowsArtifacts.length > 0) {
    warnings.push(`Detected Windows-native artifacts in this Linux checkout: ${windowsArtifacts.join(', ')}`);
  }
}

if (issues.length === 0) {
  const lines = [
    `Dependency platform check passed for ${process.platform}/${process.arch} at ${path.relative(process.cwd(), packageRoot) || '.'}.`,
  ];
  if (warnings.length > 0) {
    lines.push(...warnings.map((warning) => `warning: ${warning}`));
  }
  console.log(lines.join('\n'));
  process.exit(0);
}

console.error(`Dependency platform mismatch for ${process.platform}/${process.arch}.`);
for (const issue of issues) {
  console.error(`- ${issue}`);
}
for (const warning of warnings) {
  console.error(`- warning: ${warning}`);
}
console.error('Fix: remove node_modules for the active checkout and reinstall on this OS.');
process.exit(1);

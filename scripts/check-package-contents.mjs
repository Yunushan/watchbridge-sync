import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const packages = [
  { directory: 'apps/api', entrypoint: 'dist/server.js' },
  { directory: 'packages/core', entrypoint: 'dist/index.js' },
  { directory: 'packages/connectors', entrypoint: 'dist/index.js' }
];
const failures = [];

try {
  const packageManifest = JSON.parse(readFileSync('package.json', 'utf8'));
  if (packageManifest.license !== '0BSD')
    failures.push('root package.json must declare the 0BSD license.');
  const licenseText = readFileSync('LICENSE', 'utf8');
  if (
    !licenseText.includes('Permission to use, copy, modify, and/or distribute this software') ||
    !licenseText.includes('THE SOFTWARE IS PROVIDED "AS IS"')
  ) {
    failures.push('LICENSE must contain the 0BSD grant and warranty disclaimer.');
  }
} catch (error) {
  failures.push(`license metadata check failed: ${error instanceof Error ? error.message : String(error)}`);
}

for (const { directory, entrypoint } of packages) {
  const packed = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm pack --dry-run --json'], {
      cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    })
    : spawnSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
  if (packed.status !== 0) {
    failures.push(`${directory}: npm pack --dry-run failed: ${packed.stderr?.trim() || packed.stdout?.trim() || packed.error?.message || 'unknown error'}`);
    continue;
  }
  try {
    const report = JSON.parse(packed.stdout);
    const files = report[0]?.files?.map((file) => file.path) ?? [];
    if (!files.includes(entrypoint)) failures.push(`${directory}: publish artifact omits ${entrypoint}.`);
    if (files.some((file) => /(^|\/)dist\/.*\.test\./.test(file))) {
      failures.push(`${directory}: publish artifact includes compiled test files.`);
    }
    if (files.some((file) => file.startsWith('src/'))) failures.push(`${directory}: publish artifact includes source files.`);
  } catch {
    failures.push(`${directory}: npm pack --dry-run did not return a parseable package report.`);
  }
}

if (failures.length) {
  console.error(['Package contents check failed:', ...failures.map((failure) => `- ${failure}`)].join('\n'));
  process.exitCode = 1;
} else {
  console.log('Package contents and license check passed.');
}

import { spawnSync } from 'node:child_process';

const packages = [
  { directory: 'apps/api', entrypoint: 'dist/server.js' },
  { directory: 'packages/core', entrypoint: 'dist/index.js' },
  { directory: 'packages/connectors', entrypoint: 'dist/index.js' }
];
const failures = [];

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
  console.log('Package contents check passed.');
}

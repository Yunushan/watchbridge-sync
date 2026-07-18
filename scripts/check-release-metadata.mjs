import { readFile } from 'node:fs/promises';

const packageFiles = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'packages/cli/package.json',
  'packages/connectors/package.json',
  'packages/core/package.json'
];
const publishablePackages = new Set([
  'apps/api/package.json',
  'packages/connectors/package.json',
  'packages/core/package.json'
]);

const failures = [];
const packages = await Promise.all(packageFiles.map(async (file) => ({
  file,
  value: JSON.parse(await readFile(file, 'utf8'))
})));
const rootVersion = packages[0].value.version;
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

for (const { file, value } of packages) {
  if (value.license !== '0BSD') failures.push(`${file}: license must be 0BSD.`);
  if (value.version !== rootVersion) failures.push(`${file}: version must match root package version ${rootVersion}.`);
  for (const dependencyGroup of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, version] of Object.entries(value[dependencyGroup] ?? {})) {
      if (typeof version !== 'string' || (version !== 'workspace:*' && !exactVersion.test(version))) {
        failures.push(`${file}: ${dependencyGroup}.${name} must use an exact version or workspace:*.`);
      }
    }
  }
  if (publishablePackages.has(file)) {
    const publishedFiles = Array.isArray(value.files) ? [...value.files].sort() : [];
    if (publishedFiles.join(',') !== '!dist/**/*.test.*,dist,package.json') {
      failures.push(`${file}: published files must include dist/package.json and exclude compiled tests.`);
    }
  }
}

const license = await readFile('LICENSE', 'utf8');
if (!license.includes('Permission to use, copy, modify, and/or distribute this software')
  || !license.includes('THE SOFTWARE IS PROVIDED "AS IS"')) {
  failures.push('LICENSE: expected 0BSD license text is missing.');
}

if (failures.length) {
  console.error(['Release metadata check failed:', ...failures.map((failure) => `- ${failure}`)].join('\n'));
  process.exitCode = 1;
} else {
  console.log('Release metadata check passed.');
}

// Copies the version in package.json to every place that shows it.
//
//   npm version <patch|minor|major>   runs this automatically (the "version"
//                                     script): stamps the files, turns the
//                                     changelog's Unreleased section into this
//                                     release, then npm commits and tags.
//   npm run check-version             fails if anything is out of step.
import { readFileSync, writeFileSync } from 'node:fs';

const REPO = 'https://github.com/wpamushroomclub/iNat-foray-printer';
const check = process.argv.includes('--check');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const problems = [];

// Each place that shows the version, as a pattern whose first group is the value.
const targets = [
  { file: 'index.html', pattern: /<span id="app-version">v([^<]*)<\/span>/ },
];

for (const { file, pattern } of targets) {
  const text = readFileSync(file, 'utf8');
  const match = text.match(pattern);
  if (!match) { problems.push(`${file}: version marker not found`); continue; }
  if (match[1] === version) continue;
  if (check) { problems.push(`${file}: shows ${match[1]}, package.json has ${version}`); continue; }
  writeFileSync(file, text.replace(pattern, (m) => m.replace(match[1], version)));
  console.log(`${file}: ${match[1]} -> ${version}`);
}

// CHANGELOG.md (Keep a Changelog format).
let log = readFileSync('CHANGELOG.md', 'utf8');
const released = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(log);
if (!released) {
  if (check) {
    problems.push(`CHANGELOG.md: no "## [${version}]" section`);
  } else {
    const prev = (log.match(/^## \[(\d+\.\d+\.\d+)\]/m) || [])[1];
    const today = new Date().toISOString().slice(0, 10);
    log = log.replace(/^## \[Unreleased\]\n/m, `## [Unreleased]\n\n## [${version}] - ${today}\n`);
    log = log.replace(/^\[Unreleased\]: .*$/m,
      `[Unreleased]: ${REPO}/compare/v${version}...HEAD\n` +
      `[${version}]: ${prev ? `${REPO}/compare/v${prev}...v${version}` : `${REPO}/releases/tag/v${version}`}`);
    writeFileSync('CHANGELOG.md', log);
    console.log(`CHANGELOG.md: Unreleased -> ${version}`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
if (check) console.log(`Version ${version} is consistent.`);

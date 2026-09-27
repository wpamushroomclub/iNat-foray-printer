// Builds the release download from the committed tree:
//   dist/iNat-foray-printer-v<version>.zip   (dev files excluded, see .gitattributes)
//   dist/release-notes.md                    (this version's CHANGELOG section)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const name = `iNat-foray-printer-v${version}`;
mkdirSync('dist', { recursive: true });

execFileSync('git', ['archive', '--format=zip', '--prefix=iNat-foray-printer/',
  '-o', `dist/${name}.zip`, 'HEAD'], { stdio: 'inherit' });

const log = readFileSync('CHANGELOG.md', 'utf8');
const start = log.search(new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm'));
if (start < 0) throw new Error(`CHANGELOG.md has no section for ${version}`);
const rest = log.slice(start).split('\n').slice(1).join('\n');
const end = rest.search(/^## |^\[[^\]]+\]: /m);
const changes = (end < 0 ? rest : rest.slice(0, end)).trim();

writeFileSync('dist/release-notes.md', `## Download and run

1. Download **${name}.zip** below and unzip it.
2. Open \`index.html\` in **Chrome or Edge**. There is nothing to install.
3. To try it without a network or an iNat account, open \`index.html?demo=1\`.

See the README for printer setup.

${changes}

## License

[MIT License](https://github.com/wpamushroomclub/iNat-foray-printer/blob/v${version}/LICENSE), © Western Pennsylvania Mushroom Club. The bundled QR code library (MIT) and DM fonts (SIL OFL 1.1) keep their own licenses; see \`THIRD-PARTY-NOTICES.md\` in the download.
`);
console.log(`dist/${name}.zip\ndist/release-notes.md`);

import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
const require = createRequire(import.meta.url);
const compiler = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc');
const temporaryRoot = path.resolve(tmpdir());
const output = await mkdtemp(path.join(temporaryRoot, 'office-frontend-'));

try {
  const result = spawnSync(process.execPath, [compiler, '--project', path.join(root, 'tsconfig.json'), '--outDir', output], {
    cwd: root, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('Frontend compilation failed.');
  const stale = [];
  const emitted = (await readdir(output)).filter(file => file.endsWith('.js')).sort();
  for (const file of emitted) {
    const banner = `// Generated from frontend/${file.replace(/\.js$/, '.ts')} by pnpm build. Do not edit.\n`;
    const compiled = banner + (await readFile(path.join(output, file), 'utf8')).replace(/\r\n/g, '\n');
    const destination = path.join(root, 'public', file);
    if (check) {
      const existing = await readFile(destination, 'utf8').catch(error => {
        if (error.code === 'ENOENT') return '';
        throw error;
      });
      if (existing.replace(/\r\n/g, '\n') !== compiled) stale.push(file);
    } else {
      await writeFile(destination, compiled);
    }
  }
  for (const file of (await readdir(path.join(root, 'public'))).filter(file => file.endsWith('.js') && !emitted.includes(file))) {
    const destination = path.join(root, 'public', file);
    if (!(await readFile(destination, 'utf8')).startsWith('// Generated from frontend/')) continue;
    if (check) stale.push(`${file} (source removed)`);
    else await rm(destination);
  }
  if (stale.length) throw Error(`Generated JavaScript is out of date: ${stale.join(', ')}. Run pnpm build.`);
  console.log(check ? 'Frontend types and generated JavaScript are current.' : 'Frontend compiled to public/.');
} finally {
  // Only remove the unique compiler directory created under the system temp folder.
  if (path.dirname(output) !== temporaryRoot || !path.basename(output).startsWith('office-frontend-')) {
    throw Error('Unexpected compiler output directory.');
  }
  await rm(output, {recursive: true, force: true});
}

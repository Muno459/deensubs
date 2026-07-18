import { transform } from 'esbuild';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { createHash } from 'crypto';

// Only write when content actually changed — keeps `wrangler dev` from
// re-triggering the build in a loop (it watches src/ for file changes).
function writeIfChanged(file, content) {
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return false;
  writeFileSync(file, content);
  return true;
}

const CSS_FILES = ['src/styles/main.css', 'src/styles/fonts.css'];

// Auto-discover all JS script files
const JS_FILES = readdirSync('src/scripts')
  .filter(f => f.endsWith('.txt') && !f.endsWith('.min.txt'))
  .map(f => `src/scripts/${f}`);

async function build() {
  console.log('Building for production...\n');
  let totalBefore = 0, totalAfter = 0;
  const hash = createHash('sha256');

  // Minify CSS — target modern browsers for smaller output
  for (const file of CSS_FILES) {
    const code = readFileSync(file, 'utf8');
    const { code: min } = await transform(code, {
      loader: 'css',
      minify: true,
      target: ['chrome100', 'firefox100', 'safari16'],
      legalComments: 'none',
    });
    writeIfChanged(file.replace('.css', '.min.css'), min);
    hash.update(min);
    totalBefore += code.length;
    totalAfter += min.length;
    console.log(`  ${file}: ${code.length} → ${min.length} (${Math.round(min.length / code.length * 100)}%)`);
  }

  // Minify JS — strip console/debugger, target modern browsers, dead code elimination
  for (const file of JS_FILES) {
    const code = readFileSync(file, 'utf8');
    const { code: min } = await transform(code, {
      loader: 'js',
      minify: true,
      target: ['chrome100', 'firefox100', 'safari16'],
      drop: ['console', 'debugger'],
      legalComments: 'none',
      // Pure annotations — esbuild can remove these calls if result is unused
      pure: ['console.log', 'console.error', 'console.warn'],
    });
    writeIfChanged(file.replace('.txt', '.min.txt'), min);
    // Skip the version file itself from the hash — including it would never converge
    if (!file.endsWith('build-version.txt')) hash.update(min);
    totalBefore += code.length;
    totalAfter += min.length;
    console.log(`  ${file}: ${code.length} → ${min.length} (${Math.round(min.length / code.length * 100)}%)`);
  }

  // Build version = hash of built assets (used by service worker for cache busting).
  // Content-derived so unchanged assets keep the same version — and so `wrangler dev`
  // doesn't loop on a new timestamp every run.
  const version = 'b' + parseInt(hash.digest('hex').slice(0, 12), 16).toString(36);
  writeIfChanged('src/scripts/build-version.txt', version);
  console.log(`  Build version: ${version}`);

  console.log(`\n  Total: ${totalBefore} → ${totalAfter} bytes (saved ${totalBefore - totalAfter} bytes, ${Math.round((1 - totalAfter / totalBefore) * 100)}%)`);
}

build();

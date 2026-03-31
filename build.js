import { transform } from 'esbuild';
import { readFileSync, writeFileSync, readdirSync } from 'fs';

const CSS_FILES = ['src/styles/main.css', 'src/styles/fonts.css'];

// Auto-discover all JS script files
const JS_FILES = readdirSync('src/scripts')
  .filter(f => f.endsWith('.txt') && !f.endsWith('.min.txt'))
  .map(f => `src/scripts/${f}`);

async function build() {
  console.log('Building for production...\n');
  let totalBefore = 0, totalAfter = 0;

  // Minify CSS — target modern browsers for smaller output
  for (const file of CSS_FILES) {
    const code = readFileSync(file, 'utf8');
    const { code: min } = await transform(code, {
      loader: 'css',
      minify: true,
      target: ['chrome100', 'firefox100', 'safari16'],
      legalComments: 'none',
    });
    writeFileSync(file.replace('.css', '.min.css'), min);
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
    writeFileSync(file.replace('.txt', '.min.txt'), min);
    totalBefore += code.length;
    totalAfter += min.length;
    console.log(`  ${file}: ${code.length} → ${min.length} (${Math.round(min.length / code.length * 100)}%)`);
  }

  // Generate build version hash (used by service worker for cache busting)
  const version = Date.now().toString(36);
  writeFileSync('src/scripts/build-version.txt', version);
  console.log(`  Build version: ${version}`);

  console.log(`\n  Total: ${totalBefore} → ${totalAfter} bytes (saved ${totalBefore - totalAfter} bytes, ${Math.round((1 - totalAfter / totalBefore) * 100)}%)`);
}

build();

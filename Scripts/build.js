/**
 * Build script — bundles, minifies, and optimizes frontend assets.
 * 
 * Strategy:
 *   - search-utils.js: standalone (shared between main thread and worker)
 *   - indexed-search.js: standalone (depends on search-utils.js + LRUCache)
 *   - search-worker.js: standalone (imports search-utils via importScripts)
 *   - app-bundle.js: bundled (state + data-fetcher + ui-renderer + search-engine + monitor + app)
 *   - styles.css: minified
 *
 * Usage:
 *   npm run build         — one-shot build
 *   npm run build:watch   — watch mode
 */
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const isWatch = process.argv.includes('--watch');

const webDir = path.join(__dirname, '..', 'apps', 'web');
const distDir = path.join(__dirname, '..', 'dist');

const commonOptions = {
  minify: true,
  sourcemap: true,
  target: ['es2020', 'chrome90', 'firefox90', 'safari14'],
  charset: 'utf8',
  legalComments: 'none',
  drop: ['debugger'],
};

const builds = [
  // Standalone: search-utils (loaded by both main thread and worker)
  {
    ...commonOptions,
    bundle: false,
    entryPoints: [path.join(webDir, 'search-utils.js')],
    outfile: path.join(distDir, 'search-utils.min.js'),
  },
  // Standalone: indexed search engine
  {
    ...commonOptions,
    bundle: false,
    entryPoints: [path.join(webDir, 'indexed-search.js')],
    outfile: path.join(distDir, 'indexed-search.min.js'),
  },
  // Standalone: Web Worker (cannot be bundled — uses importScripts)
  {
    ...commonOptions,
    bundle: false,
    entryPoints: [path.join(webDir, 'search-worker.js')],
    outfile: path.join(distDir, 'search-worker.min.js'),
  },
  // Bundle: main application (state + fetcher + UI + search-engine + monitor + app)
  {
    ...commonOptions,
    bundle: true,
    entryPoints: [path.join(webDir, 'app.js')],
    outfile: path.join(distDir, 'app.bundle.min.js'),
    external: [],
    // These are loaded as separate scripts, so treat their globals as external
    banner: {
      js: '/* Electoral Roll Search - bundled app */',
    },
  },
  // CSS minification
  {
    ...commonOptions,
    bundle: false,
    entryPoints: [path.join(webDir, 'styles.css')],
    outfile: path.join(distDir, 'styles.min.css'),
  },
  // Service Worker (standalone)
  {
    ...commonOptions,
    bundle: false,
    entryPoints: [path.join(webDir, 'sw.js')],
    outfile: path.join(distDir, 'sw.min.js'),
  },
];

async function build() {
  // Ensure dist/ exists
  const distDir = path.join(__dirname, '..', 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // Track filename mappings for HTML rewriting
  const fileMap = {};

  for (const options of builds) {
    if (isWatch) {
      const ctx = await esbuild.context(options);
      await ctx.watch();
      console.log(`Watching: ${path.basename(options.entryPoints[0])}`);
    } else {
      const result = await esbuild.build(options);
      const outFile = options.outfile;
      const sourceFile = options.entryPoints[0];
      const sourceStats = fs.statSync(sourceFile);

      // Generate content hash for cache-busting
      const content = fs.readFileSync(outFile);
      const hash = crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
      const ext = path.extname(outFile);
      const baseName = path.basename(outFile, ext);
      const hashedName = `${baseName}.${hash}${ext}`;
      const hashedPath = path.join(path.dirname(outFile), hashedName);

      // Rename to hashed filename
      fs.renameSync(outFile, hashedPath);
      const stats = fs.statSync(hashedPath);
      const reduction = ((1 - stats.size / sourceStats.size) * 100).toFixed(1);
      console.log(`  ${hashedName}: ${(stats.size / 1024).toFixed(1)} KB (${reduction}% smaller)`);

      // Track mapping: original source name → hashed output name
      const srcBase = path.basename(sourceFile);
      fileMap[srcBase] = hashedName;

      // Also rename sourcemap if it exists
      const mapFile = outFile + '.map';
      if (fs.existsSync(mapFile)) {
        fs.renameSync(mapFile, hashedPath + '.map');
      }
    }
  }

  if (!isWatch) {
    // Copy index.html to dist with cache-busted references
    const htmlSrc = path.join(__dirname, '..', 'apps', 'web', 'index.html');
    const htmlDst = path.join(distDir, 'index.html');
    let html = fs.readFileSync(htmlSrc, 'utf8');

    // Replace each source file reference with its hashed equivalent
    for (const [src, hashed] of Object.entries(fileMap)) {
      html = html.replace(src, hashed);
    }

    fs.writeFileSync(htmlDst, html, 'utf8');
    console.log('  index.html: copied with cache-busted references');

    // Write manifest for deployment verification
    const manifestPath = path.join(distDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(fileMap, null, 2), 'utf8');
    console.log('  manifest.json: file mapping written');
    console.log('\nBuild complete → dist/');
  }
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});

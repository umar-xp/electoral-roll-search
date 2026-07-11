/**
 * Build script — bundles, minifies, and optimizes frontend assets.
 * 
 * Strategy:
 *   - All browser scripts referenced by index.html are emitted into dist/
 *   - Runtime asset references are rewritten to hashed output filenames
 *   - dist/ is rebuilt from scratch each run to avoid stale files
 *   - styles.css is minified
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
  ['search-utils.js', 'search-utils.min.js'],
  ['indexed-search.js', 'indexed-search.min.js'],
  ['search-engine.js', 'search-engine.min.js'],
  ['state.js', 'state.min.js'],
  ['data-fetcher.js', 'data-fetcher.min.js'],
  ['ui-renderer.js', 'ui-renderer.min.js'],
  ['i18n.js', 'i18n.min.js'],
  ['monitor.js', 'monitor.min.js'],
  ['app.js', 'app.min.js'],
  ['search-worker.js', 'search-worker.min.js'],
  ['styles.css', 'styles.min.css'],
  ['sw.js', 'sw.min.js'],
].map(([src, out]) => ({
  ...commonOptions,
  bundle: false,
  entryPoints: [path.join(webDir, src)],
  outfile: path.join(distDir, out),
}));

const extraStaticFiles = [
  'about.html',
  'request-assisted.html',
  'request-status.html',
  'request-admin.html',
  'request-assisted.css',
  'request-assisted-config.js',
  'request-assisted-common.js',
  'request-assisted-form.js',
  'request-assisted-status.js',
  'request-assisted-admin.js',
];

function rewriteContent(content, fileMap) {
  const replacements = Object.entries(fileMap).sort((a, b) => b[0].length - a[0].length);
  let rewritten = content;
  for (const [src, hashed] of replacements) {
    rewritten = rewritten.split(src).join(hashed);
  }
  return rewritten;
}

async function build() {
  // Recreate dist/ from scratch to avoid stale hashed files.
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

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
    // Copy index.html to dist with cache-busted references.
    const htmlSrc = path.join(__dirname, '..', 'apps', 'web', 'index.html');
    const htmlDst = path.join(distDir, 'index.html');
    const html = rewriteContent(fs.readFileSync(htmlSrc, 'utf8'), fileMap);

    fs.writeFileSync(htmlDst, html, 'utf8');
    console.log('  index.html: copied with cache-busted references');

    // Rewrite runtime asset references inside generated JS/CSS too
    for (const hashed of Object.values(fileMap)) {
      const builtPath = path.join(distDir, hashed);
      if (!fs.existsSync(builtPath)) continue;
      const ext = path.extname(builtPath);
      if (!['.js', '.css', '.html'].includes(ext)) continue;
      const rewritten = rewriteContent(fs.readFileSync(builtPath, 'utf8'), fileMap);
      fs.writeFileSync(builtPath, rewritten, 'utf8');
    }

    // Copy auxiliary static pages/assets for assisted-search flows.
    for (const relativeFile of extraStaticFiles) {
      const srcPath = path.join(webDir, relativeFile);
      if (!fs.existsSync(srcPath)) continue;
      const dstPath = path.join(distDir, relativeFile);
      const ext = path.extname(relativeFile);
      const source = fs.readFileSync(srcPath, 'utf8');
      const rewritten = ['.html', '.js', '.css'].includes(ext)
        ? rewriteContent(source, fileMap)
        : source;
      fs.writeFileSync(dstPath, rewritten, 'utf8');
      console.log(`  ${relativeFile}: copied`);
    }

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

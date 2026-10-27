// Bundles the demo and the examples with the SDK into dist/ (esbuild): pnpm build
import { build } from 'esbuild';

await build({
  entryPoints: { 'demo': 'demo/main.ts', 'examples/vanilla': 'examples/vanilla/main.ts', 'examples/react': 'examples/react/main.tsx', 'examples/conversation': 'examples/conversation/main.ts', 'check/sdk': 'check/sdk.ts', 'check/tts': 'check/tts.ts', 'check/geometry': 'check/geometry.ts' },
  outdir: 'dist', bundle: true, format: 'esm', target: 'es2022', platform: 'browser', jsx: 'automatic', minify: false,
  sourcemap: true, logLevel: 'info', define: { 'process.env.NODE_ENV': '"production"' },
});

/** The model runtime's own bundle (ESM, self-contained), inlined into main.js
 *  by esbuild's `define` in esbuild.config.mjs. One bundle serves both the Web
 *  Worker and the iframe fallback; it tells which it is at runtime. */
declare const __EMBEDDING_BUNDLE_PLACEHOLDER__: string;

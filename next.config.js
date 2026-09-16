/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Ship the ML artifacts into the serverless bundles.
    //
    // @vercel/nft traces files by statically analysing paths. It finds
    // data/ml/registry.json because lib/ml/registry.ts spells it out in
    // literals, but the artifacts themselves are located by READING that
    // registry at runtime:
    //
    //   abs = path.join(process.cwd(), entry.artifacts.path)
    //
    // Nothing static points at data/ml/value.json, so tracing dropped it and
    // every lambda got a registry promising a model whose file was not there.
    // readFileSync threw ENOENT, the catch swallowed it, and every ML
    // consumer silently fell back — the coach route 503'd, battle analysis
    // shipped without a win-probability curve, and the AI opponent played on
    // heuristics instead of value-gbm-v1.
    //
    // Globs rather than the routes by name: an enumerated list is exactly
    // what goes stale and reproduces this for the next route that needs an
    // artifact. All of data/ml is 656 KB, and a file that is present but
    // never read costs nothing at runtime.
    outputFileTracingIncludes: {
      "/api/**": ["./data/ml/**"],
      "/admin-tools/**": ["./data/ml/**"],
    },
  },
};

module.exports = nextConfig;

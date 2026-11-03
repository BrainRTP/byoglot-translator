// svelte-check 4.7.8 does not support TypeScript 7 without --tsgo, so give it a private TypeScript 6.
function readPackage(pkg) {
  if (pkg.name === "svelte-check") {
    delete pkg.peerDependencies.typescript;
    pkg.dependencies = { ...pkg.dependencies, typescript: "6.0.3" };
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };

/**
 * antirea — javascript-obfuscator config
 *
 * Copy this to your project root as obfuscator.config.js
 * Used by templates/scripts/antirea-obfuscate.js
 *
 * Install dependency:
 *   npm install --save-dev javascript-obfuscator
 *
 * What each option does against REA:
 *   identifierNamesGenerator: "mangled"
 *     → All variable/function names become a, b, c, ...
 *     → REA's module graph and symbol analysis returns nothing useful
 *
 *   renameGlobals: true
 *     → Top-level names are also renamed
 *     → Breaks REA's entry point detection
 *
 *   stringArray + stringArrayEncoding: ["rc4"]
 *     → String literals are extracted into an encrypted array
 *     → REA's string extraction returns encrypted blobs, not real values
 *     → IPC channel names, API endpoints, feature flag keys all become opaque
 *
 *   splitStrings: true
 *     → Remaining string constants are split into concatenated fragments
 *     → "clipboard-read" → "clip" + "board" + "-read" (at runtime only)
 *
 *   controlFlowFlattening: true
 *     → Control flow is converted to a dispatcher/state-machine pattern
 *     → REA's trace_application_feature cannot follow logic paths
 *
 *   deadCodeInjection: true
 *     → Meaningless code branches are injected throughout
 *     → REA wastes tokens analyzing code that never executes
 *
 *   selfDefending: true
 *     → Output resists formatting and prettifying
 *     → Slows down manual post-processing of REA output
 *
 *   disableConsoleOutput: true
 *     → Removes console.log/warn/error calls
 *     → Eliminates the most common source of readable string leakage
 *
 * Performance note:
 *   controlFlowFlattening and deadCodeInjection increase bundle size and
 *   slightly reduce runtime performance. Tune thresholdRate if needed.
 *   For production, start with 0.5 and reduce if performance is impacted.
 */

module.exports = {
  // Identifier obfuscation
  identifierNamesGenerator: "mangled",
  renameGlobals: true,
  renameProperties: false,        // true can break third-party libs — test carefully

  // String obfuscation
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.75,
  stringArrayEncoding: ["rc4"],
  stringArrayIndexesType: ["hexadecimal-number", "hexadecimal-numeric-string"],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 5,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 5,
  stringArrayWrappersType: "function",
  stringArrayThreshold: 0.75,

  splitStrings: true,
  splitStringsChunkLength: 5,

  unicodeEscapeSequence: false,   // true makes output larger, marginal benefit

  // Control flow obfuscation
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,

  // Dead code injection
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,

  // Self defense
  selfDefending: true,
  disableConsoleOutput: true,
  debugProtection: false,         // can cause issues in some environments

  // Source map — NEVER emit source maps in distribution
  sourceMap: false,
  sourceMapMode: "off",

  // Target environment
  target: "browser",              // change to "node" for Node.js/Electron main

  // Seed for reproducible builds (optional — set to a fixed number for CI)
  // seed: 12345,
};

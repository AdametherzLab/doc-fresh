/**
 * @fileoverview Public API barrel for doc-fresh.
 * Re-exports all externally consumable functions and types for programmatic usage.
 * Import from this file when using doc-fresh as a library.
 * 
 * @example
 * ```typescript
 * import { scanProject, fetchPackageMetadata, extractBreakingChanges } from "doc-fresh";
 * import type { ProjectScanResult, PackageMetadata } from "doc-fresh";
 * ```
 * 
 * @module doc-fresh
 */

// Type definitions
export type {
  CliOptions,
  FilePath,
  PackageName,
  SemVerString,
  ImportUsage,
  FileScanResult,
  ProjectScanResult,
  PackageMetadata,
  BreakingChange,
  RegistryFetchResult,
  StalenessReport,
  SeverityLevel
} from "./types.js";

// Type guard utilities and branded type constructors
export {
  createPackageName,
  createFilePath,
  createSemVer,
  meetsSeverityThreshold
} from "./types.js";

// Source code scanning
export { scanProject } from "./scanner.js";

// NPM registry and changelog analysis
export {
  fetchPackageMetadata,
  fetchChangelogText,
  parseChangelogText,
  extractBreakingChanges
} from "./registry.js";
/**
 * Central type definitions for doc-fresh.
 * Single source of truth for all shared data structures across scanner,
 * registry, and CLI modules.
 */

/** Branded type for validated npm package names. */
export type PackageName = string & { readonly __brand: 'PackageName' };

/** Branded type for semantic version strings. */
export type SemVerString = string & { readonly __brand: 'SemVerString' };

/** Branded type for absolute or relative file system paths. */
export type FilePath = string & { readonly __brand: 'FilePath' };

/** Severity levels for staleness and breaking changes. */
export type SeverityLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Represents a detected import usage in source code.
 * Captures what was imported and where it was found.
 */
export interface ImportUsage {
  readonly packageName: PackageName;
  readonly importedIdentifiers: readonly string[];
  readonly sourceFile: FilePath;
  readonly lineNumber: number;
  readonly columnNumber: number;
  readonly importType: 'named' | 'default' | 'namespace' | 'side-effect';
  readonly isTypeOnly: boolean;
}

/**
 * Raw metadata from npm registry for a specific package version.
 */
export interface PackageMetadata {
  readonly name: PackageName;
  readonly version: SemVerString;
  readonly publishDate: Date;
  readonly deprecated?: string;
  readonly repositoryUrl?: string;
  readonly changelogUrl?: string;
  readonly homepage?: string;
  readonly distTags: Readonly<Record<string, SemVerString>>;
  readonly maintainers: readonly string[];
}

/**
 * Parsed breaking change entry from changelog analysis.
 * Represents a signal that a specific export or behavior changed.
 */
export interface BreakingChange {
  readonly type: 'export-removal' | 'signature-change' | 'rename' | 'behavior-change' | 'deprecation';
  readonly version: SemVerString;
  readonly date: Date;
  readonly description: string;
  readonly affectedExports: readonly string[];
  readonly migrationGuide?: string;
  readonly severity: SeverityLevel;
}

/**
 * Complete staleness report for a single package.
 * Contains the diff between current usage and latest package state.
 */
export interface StalenessReport {
  readonly packageName: PackageName;
  readonly currentVersion: SemVerString;
  readonly latestVersion: SemVerString;
  readonly installedDate?: Date;
  readonly latestPublishDate: Date;
  readonly outdatedImports: readonly ImportUsage[];
  readonly relevantBreakingChanges: readonly BreakingChange[];
  readonly severity: SeverityLevel;
  readonly recommendation: string;
  readonly upgradePath?: readonly SemVerString[];
}

/**
 * Configuration options for CLI execution.
 */
export interface CliOptions {
  readonly scanPath: FilePath;
  readonly configPath?: FilePath;
  readonly outputFormat: 'json' | 'markdown' | 'console';
  readonly severityThreshold: SeverityLevel;
  readonly ignorePackages: readonly PackageName[];
  readonly includeDevDependencies: boolean;
  readonly checkChangelogs: boolean;
}

/**
 * Result of scanning a single file for imports.
 */
export interface FileScanResult {
  readonly filePath: FilePath;
  readonly imports: readonly ImportUsage[];
  readonly parseErrors: readonly string[];
}

/**
 * Aggregated scan results for entire project.
 */
export interface ProjectScanResult {
  readonly scannedFiles: readonly FileScanResult[];
  readonly totalFiles: number;
  readonly uniquePackages: ReadonlySet<PackageName>;
  readonly errors: readonly string[];
}

/**
 * Registry fetch result with metadata or error information.
 */
export interface RegistryFetchResult {
  readonly packageName: PackageName;
  readonly metadata: PackageMetadata | null;
  readonly error?: string;
  readonly fetchDurationMs: number;
}

/**
 * Create a branded PackageName after validation.
 * @param name - Raw package name string
 * @returns Branded PackageName type
 * @throws {Error} If package name is empty or contains invalid characters
 * @example
 * const pkg = createPackageName('lodash');
 * // returns 'lodash' as PackageName type
 */
export function createPackageName(name: string): PackageName {
  if (!name || name.length === 0) {
    throw new Error('Package name cannot be empty');
  }
  if (!/^(?:@[a-z0-9\-_.]+\/)?[a-z0-9\-_.]+$/.test(name)) {
    throw new Error(`Invalid package name format: ${name}`);
  }
  return name as PackageName;
}

/**
 * Create a branded FilePath.
 * @param rawPath - Raw path string (absolute or relative)
 * @returns Branded FilePath type
 * @throws {Error} If path is empty
 * @example
 * const fp = createFilePath('./src/index.ts');
 */
export function createFilePath(rawPath: string): FilePath {
  if (!rawPath || rawPath.length === 0) {
    throw new Error('File path cannot be empty');
  }
  return rawPath as FilePath;
}

/**
 * Create a branded SemVerString after basic validation.
 * @param version - Raw version string (e.g., "1.2.3" or "1.2.3-beta.1")
 * @returns Branded SemVerString type
 * @throws {Error} If version format is invalid (must start with major.minor.patch)
 * @example
 * const ver = createSemVer('2.1.0');
 */
export function createSemVer(version: string): SemVerString {
  if (!version || version.length === 0) {
    throw new Error('Version string cannot be empty');
  }
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`Invalid semantic version format: ${version}. Expected format: major.minor.patch`);
  }
  return version as SemVerString;
}

/**
 * Check if a severity level meets or exceeds a threshold.
 * @param level - The severity level to evaluate
 * @param threshold - The minimum required severity
 * @returns True if level is equal to or higher than threshold
 * @throws {RangeError} If either level or threshold is invalid
 * @example
 * const shouldReport = meetsSeverityThreshold('high', 'medium'); // true
 * const shouldIgnore = meetsSeverityThreshold('low', 'medium'); // false
 */
export function meetsSeverityThreshold(
  level: SeverityLevel,
  threshold: SeverityLevel
): boolean {
  const levels: readonly SeverityLevel[] = ['low', 'medium', 'high', 'critical'];
  const levelIndex = levels.indexOf(level);
  const thresholdIndex = levels.indexOf(threshold);
  
  if (levelIndex === -1) {
    throw new RangeError(`Invalid severity level: ${level}. Must be one of: ${levels.join(', ')}`);
  }
  if (thresholdIndex === -1) {
    throw new RangeError(`Invalid severity threshold: ${threshold}. Must be one of: ${levels.join(', ')}`);
  }
  
  return levelIndex >= thresholdIndex;
}
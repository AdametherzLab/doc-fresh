[![CI](https://github.com/AdametherzLab/doc-fresh/actions/workflows/ci.yml/badge.svg)](https://github.com/AdametherzLab/doc-fresh/actions) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

# doc-fresh 🧼

Stop debugging ghost APIs. `doc-fresh` scans your TypeScript imports, fetches live npm metadata, and flags breaking changes before they break your build.

## Features

- ✅ **Zero-config scanning** — Automatically finds TypeScript/JavaScript imports via AST parsing
- ✅ **Live npm intelligence** — Fetches real-time package metadata and changelog data from the registry
- ✅ **Breaking change detection** — Identifies renamed exports, dropped methods, and signature changes using heuristic analysis
- ✅ **Multiple output formats** — Text, JSON, or Markdown reports to fit your CI/CD workflow
- ✅ **Zero external dependencies** — No API keys needed; pure npm registry + AST magic

## Installation

```bash
# Global installation
npm install -g @adametherzlab/doc-fresh

# Local project installation
npm install @adametherzlab/doc-fresh

# Using Bun
bun add @adametherzlab/doc-fresh
```

## Quick Start

```bash
# Scan current directory
npx @adametherzlab/doc-fresh .

# Scan specific path with options
npx @adametherzlab/doc-fresh ./src --format markdown --severity high --ignore lodash,express
```

Real terminal session output:

```bash
$ npx @adametherzlab/doc-fresh ./my-project

🔍 Scanning 24 TypeScript files...
📦 Analyzing 12 unique dependencies

⚠️  Stale dependencies detected:

lodash (4.17.20 → 4.17.21)
  🔴 CRITICAL: _.omit behavior changed (no longer clones deep properties)
  📄 https://unpkg.com/lodash@4.17.21/CHANGELOG.md

express (4.17.1 → 4.18.2)
  🟡 MEDIUM: req.host deprecated in favor of req.hostname
  📄 https://unpkg.com/express@4.18.2/History.md

2 packages flagged (1 critical, 1 medium). Run with --format json for CI integration.
```

## API Reference

### Exported Types

**Branded Types**
- `FilePath` — Validated filesystem path (opaque branded string)
- `PackageName` — Validated npm package identifier (opaque branded string)  
- `SemVerString` — Validated semantic version string (e.g., "2.1.0")

**Domain Types**
- `CliOptions` — Configuration interface for CLI execution
- `ImportUsage` — Detected import declaration with location metadata
- `FileScanResult` — Single file analysis results
- `ProjectScanResult` — Aggregated project scan with unique packages and imports
- `PackageMetadata` — Raw npm registry manifest data
- `BreakingChange` — Structured breaking change entry with severity and description
- `RegistryFetchResult` — Discriminated union of fetch success or failure
- `StalenessReport` — Comprehensive diff report between current usage and latest package state
- `SeverityLevel` — Union type: `'critical' | 'high' | 'medium' | 'low'`

### Exported Functions

#### Type Constructors

```typescript
createPackageName(name: string): PackageName
```
```typescript
const pkg = createPackageName('@types/node');
```

```typescript
createFilePath(rawPath: string): FilePath
```
Creates a branded FilePath. Throws `Error` if path is empty.
```typescript
const project = createFilePath('./src');
```

```typescript
createSemVer(version: string): SemVerString
```
Creates a branded SemVerString. Validates major.minor.patch format. Throws `Error` if invalid.
```typescript
const ver = createSemVer('2.1.0');
```

#### Analysis Functions

```typescript
meetsSeverityThreshold(level: SeverityLevel, threshold: SeverityLevel): boolean
```
```typescript
const shouldReport = meetsSeverityThreshold('high', 'medium'); // true
```

```typescript
scanProject(projectPath: FilePath, options: { includeDevDependencies?: boolean; ignorePackages?: PackageName[] }): ProjectScanResult
```
Recursively scans TypeScript/JavaScript files for import declarations. Returns aggregated statistics and detected imports.
```typescript
const result = scanProject(createFilePath('./src'), { includeDevDependencies: false });
```

```typescript
fetchPackageMetadata(packageName: PackageName): Promise<RegistryFetchResult>
```
```typescript
const result = await fetchPackageMetadata(createPackageName('lodash'));
if (result.metadata) console.log(result.metadata.version);
```

```typescript
fetchChangelogText(packageName: PackageName, version: SemVerString): Promise<string>
```
```typescript
const changelog = await fetchChangelogText(pkg, '2.0.0');
```

```typescript
parseChangelogText(text: string, packageName: PackageName): readonly BreakingChange[]
```
```typescript
const changes = parseChangelogText(changelogText, pkg);
```

```typescript
extractBreakingChanges(metadata: PackageMetadata, fromVersion: SemVerString, toVersion: SemVerString): readonly BreakingChange[]
```
```typescript
const changes = extractBreakingChanges(meta, createSemVer('1.0.0'), createSemVer('2.0.0'));
```

## Advanced Usage

```typescript
import { 
  scanProject, 
  fetchPackageMetadata, 
  extractBreakingChanges,
  createFilePath,
  createPackageName,
  createSemVer,
  meetsSeverityThreshold 
} from '@adametherzlab/doc-fresh';
// REMOVED external import: import type { BreakingChange, SeverityLevel, PackageName } from '@adametherzlab/doc-fresh';

async function generateStalenessReport(
  projectRoot: string, 
  minSeverity: SeverityLevel = 'high'
): Promise<BreakingChange[]> {
  const scan = scanProject(createFilePath(projectRoot), {
    includeDevDependencies: false,
    ignorePackages: [createPackageName('internal-helpers')]
  });
  
  const breakingChanges: BreakingChange[] = [];
  
  for (const pkg of scan.uniquePackages) {
    const fetchResult = await fetchPackageMetadata(pkg);
    if (!fetchResult.metadata) continue;
    
    const currentImport = scan.imports.find(i => i.packageName === pkg);
    if (!currentImport?.version) continue;
    
    const changes = extractBreakingChanges(
      fetchResult.metadata,
      createSemVer(currentImport.version),
      createSemVer(fetchResult.metadata.version)
    );
    
    breakingChanges.push(
      ...changes.filter(c => meetsSeverityThreshold(c.severity, minSeverity))
    );
  }
  
  return breakingChanges;
}

// Generate markdown report for CI
generateStalenessReport('./src', 'medium').then(changes => {
  console.log(`Found ${changes.length} breaking changes`);
});
```

### How Breaking Change Detection Works

doc-fresh combines static analysis with registry heuristics:

1. **AST Parsing** — Uses the TypeScript compiler API to extract import declarations and usage patterns without executing code
2. **Registry Intelligence** — Fetches package metadata and changelog text from npm/unpkg CDNs
3. **Heuristic Analysis** — Parses changelogs using regex patterns to detect keywords like "removed", "renamed", "deprecated", "breaking", and "dropped"
4. **Version Diffing** — Compares your installed version against latest to scope relevant changes only

### Output Formats

- **text** (default): Human-readable terminal output with emoji indicators and severity color coding
- **json**: Machine-parseable JSON with full metadata arrays for CI/CD integration and programmatic processing
- **markdown**: GitHub-flavored markdown suitable for PR comments or documentation generation

### Known Limitations

- **No type-level diffing** — We detect API surface changes, not TypeScript type definition mismatches between versions
- **Heuristic changelog parsing** — Relies on keyword matching; unconventional changelog formats or sparse release notes may be missed
- **Static analysis only** — Cannot detect dynamic requires, conditional imports, or runtime-generated module paths
- **npm registry only** — Private registries or monorepo internal packages require additional configuration not included in core

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)

## License

MIT (c) [AdametherzLab](https://github.com/AdametherzLab)
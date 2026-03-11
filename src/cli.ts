import * as path from "path";
import * as fs from "fs";
import type { CliOptions, FilePath, PackageName, StalenessReport, SeverityLevel, ImportUsage, ProjectScanResult, PackageMetadata } from "./types.js";
import { createPackageName, createFilePath, createSemVer, meetsSeverityThreshold } from "./types.js";
import { scanProject } from "./scanner.js";
import { fetchPackageMetadata } from "./registry.js";
import { detectBreakingChanges } from "./analyzer.js";

const VERSION = "0.1.0";
const HELP_TEXT = `doc-fresh v${VERSION}
Usage: doc-fresh [options]

Options:
  --path <dir>              Scan directory (default: .)
  --packages <list>         Comma-separated packages to check (whitelist)
  --output <format>         Output format: json, markdown, console (default: console)
  --severity-threshold <l>  Minimum severity: low, medium, high, critical (default: low)
  --ignore-packages <list>  Comma-separated packages to ignore
  --config <path>           Path to configuration file
  --verbose                 Enable verbose logging
  --version                 Show version
  --help                    Show this help`;

const COL = { r: "\x1b[31m", y: "\x1b[33m", g: "\x1b[32m", c: "\x1b[36m", x: "\x1b[0m" };

/** Structure of parsed CLI arguments. */
interface ParsedFlags {
  readonly scanPath: string;
  readonly packages?: readonly string[];
  readonly output: 'json' | 'markdown' | 'console';
  readonly verbose: boolean;
  readonly help: boolean;
  readonly version: boolean;
  readonly severityThreshold: SeverityLevel;
  readonly ignorePackages: readonly string[];
  readonly configPath?: string;
}

/**
 * Parse raw command line arguments into structured flags.
 * @param argv - Raw process.argv array
 * @returns Parsed flags with validated defaults
 * @throws {Error} If unknown flag provided or required value missing
 * @example
 * const flags = parseArgs(process.argv);
 */
export function parseArgs(argv: string[]): ParsedFlags {
  const args = argv.slice(2);
  const result: ParsedFlags = { scanPath: ".", output: "console", verbose: false, help: false, version: false, severityThreshold: "low", ignorePackages: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help") result.help = true;
    else if (arg === "--version") result.version = true;
    else if (arg === "--verbose") result.verbose = true;
    else if (arg === "--path") { if (++i >= args.length) throw new Error("--path requires a directory path"); result.scanPath = args[i]; }
    else if (arg === "--packages") { if (++i >= args.length) throw new Error("--packages requires comma-separated list"); result.packages = args[i].split(",").map(s => s.trim()).filter(Boolean); }
    else if (arg === "--output") { if (++i >= args.length) throw new Error("--output requires format name"); if (!["json", "markdown", "console"].includes(args[i])) throw new Error(`Invalid output format: ${args[i]}. Use: json, markdown, console`); result.output = args[i] as 'json' | 'markdown' | 'console'; }
    else if (arg === "--severity-threshold") { if (++i >= args.length) throw new Error("--severity-threshold requires level"); if (!["low", "medium", "high", "critical"].includes(args[i])) throw new Error(`Invalid severity: ${args[i]}. Use: low, medium, high, critical`); result.severityThreshold = args[i] as SeverityLevel; }
    else if (arg === "--ignore-packages") { if (++i >= args.length) throw new Error("--ignore-packages requires comma-separated list"); result.ignorePackages = args[i].split(",").map(s => s.trim()).filter(Boolean); }
    else if (arg === "--config") { if (++i >= args.length) throw new Error("--config requires file path"); result.configPath = args[i]; }
    else if (arg.startsWith("-")) throw new Error(`Unknown flag: ${arg}`);
  }
  return result;
}

/**
 * Extract installed version from package.json dependencies.
 * @param pkg - Package name to lookup
 * @param projectPath - Directory containing package.json
 * @returns Clean version string (without ~ or ^) or undefined if not found
 */
function getInstalledVersion(pkg: PackageName, projectPath: string): string | undefined {
  try {
    const pkgPath = path.join(projectPath, "package.json");
    if (!fs.existsSync(pkgPath)) return undefined;
    const content = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const raw: string | undefined = content.dependencies?.[pkg] ?? content.devDependencies?.[pkg] ?? content.peerDependencies?.[pkg];
    return raw?.replace(/^[~^]/, "");
  } catch { return undefined; }
}

/**
 * Render reports to console with ANSI colors and diff-style formatting.
 * @param reports - Staleness reports to display
 * @param verbose - Include breaking change details
 */
function renderConsole(reports: readonly StalenessReport[], verbose: boolean): void {
  if (reports.length === 0) { console.log(`${COL.g}✓ No stale packages detected${COL.x}`); return; }
  for (const r of reports) {
    const col = r.severity === "critical" || r.severity === "high" ? COL.r : r.severity === "medium" ? COL.y : COL.g;
    console.log(`${col}[${r.severity.toUpperCase()}] ${r.packageName}${COL.x}`);
    console.log(`  ${COL.c}Current:${COL.x}  ${r.currentVersion}`);
    console.log(`  ${COL.g}Latest:${COL.x}   ${r.latestVersion}`);
    if (r.recommendation) console.log(`  ${COL.y}→ ${r.recommendation}${COL.x}`);
    if (verbose && r.relevantBreakingChanges.length > 0) {
      console.log(`  ${COL.r}Breaking changes:${COL.x}`);
      for (const b of r.relevantBreakingChanges) console.log(`    - ${b.description} (${b.type})`);
    }
  }
}

/**
 * Render reports as Markdown.
 * @param reports - Staleness reports to display
 */
function renderMarkdown(reports: readonly StalenessReport[]): void {
  console.log("# Doc-Fresh Report\n");
  if (reports.length === 0) { console.log("✅ No stale packages detected."); return; }
  for (const r of reports) {
    console.log(`## ${r.packageName} \`${r.severity}\``);
    console.log(`- **Current:** ${r.currentVersion}`);
    console.log(`- **Latest:** ${r.latestVersion}`);
    if (r.recommendation) console.log(`- **Action:** ${r.recommendation}`);
    for (const b of r.relevantBreakingChanges) console.log(`- ⚠️ **${b.type}:** ${b.description}`);
    console.log("");
  }
}

/**
 * Execute the doc-fresh analysis pipeline.
 * @param argv - Command line arguments
 * @returns Exit code (0 if no issues above threshold, 1 if critical/high severity found or runtime error)
 * @example
 * const exitCode = await run(process.argv);
 * process.exit(exitCode);
 */
export async function run(argv: string[]): Promise<number> {
  try {
    const flags = parseArgs(argv);
    if (flags.help) { console.log(HELP_TEXT); return 0; }
    if (flags.version) { console.log(VERSION); return 0; }

    const scanPath = path.resolve(flags.scanPath);
    if (!fs.existsSync(scanPath)) throw new Error(`Scan path does not exist: ${flags.scanPath}`);

    const options: CliOptions = {
      scanPath: createFilePath(scanPath),
      outputFormat: flags.output,
      severityThreshold: flags.severityThreshold,
      ignorePackages: flags.ignorePackages.map(p => createPackageName(p)),
      includeDevDependencies: true,
      checkChangelogs: true,
      ...(flags.configPath && { configPath: createFilePath(path.resolve(flags.configPath)) })
    } satisfies CliOptions;

    if (flags.verbose) console.error(`Scanning ${scanPath}...`);
    const scanResult: ProjectScanResult = await scanProject(options.scanPath);

    let packagesToProcess = Array.from(scanResult.uniquePackages).filter(p => !options.ignorePackages.includes(p));
    if (flags.packages && flags.packages.length > 0) {
      const allowed = new Set(flags.packages.map(p => createPackageName(p)));
      packagesToProcess = packagesToProcess.filter(p => allowed.has(p));
    }

    const reports: StalenessReport[] = [];
    let hasHighSeverityIssues = false;

    for (const pkg of packagesToProcess) {
      try {
        const installedVersionStr = getInstalledVersion(pkg, scanPath);
        if (!installedVersionStr) {
          if (flags.verbose) console.error(`Package ${pkg} not found in package.json dependencies.`);
          continue;
        }
        const currentVersion = createSemVer(installedVersionStr);

        const fetchResult = await fetchPackageMetadata(pkg);
        if (fetchResult.error) {
          if (flags.verbose) console.error(`Error fetching metadata for ${pkg}: ${fetchResult.error}`);
          continue;
        }
        const meta: PackageMetadata | null = fetchResult.metadata;
        if (!meta) {
          if (flags.verbose) console.error(`No metadata found for ${pkg}`);
          continue;
        }
        const latestVersion = meta.version;

        const relevantBreakingChanges = await detectBreakingChanges(pkg, currentVersion, latestVersion);

        const outdatedImports: ImportUsage[] = scanResult.scannedFiles
          .flatMap(f => f.imports)
          .filter(i => i.packageName === pkg);

        // Simplified severity calculation for example
        let severity: SeverityLevel = "low";
        if (relevantBreakingChanges.length > 0) {
          severity = "high"; // Assume any breaking change is high severity for now
          if (relevantBreakingChanges.some(bc => bc.severity === "critical")) {
            severity = "critical";
          }
        } else if (currentVersion !== latestVersion) {
          severity = "medium"; // Outdated but no breaking changes
        }

        const recommendation = currentVersion !== latestVersion ? `Upgrade to ${latestVersion}` : "No action needed";

        const report: StalenessReport = {
          packageName: pkg,
          currentVersion: currentVersion,
          latestVersion: latestVersion,
          latestPublishDate: meta.publishDate,
          outdatedImports: outdatedImports,
          relevantBreakingChanges: relevantBreakingChanges,
          severity: severity,
          recommendation: recommendation,
        };

        if (meetsSeverityThreshold(report.severity, options.severityThreshold)) {
          reports.push(report);
          if (report.severity === "high" || report.severity === "critical") {
            hasHighSeverityIssues = true;
          }
        }

      } catch (error: unknown) {
        console.error(`Error processing package ${pkg}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (options.outputFormat === "json") {
      console.log(JSON.stringify(reports, null, 2));
    } else if (options.outputFormat === "markdown") {
      renderMarkdown(reports);
    } else {
      renderConsole(reports, flags.verbose);
    }

    return hasHighSeverityIssues ? 1 : 0;

  } catch (error: unknown) {
    console.error(`${COL.r}Error: ${error instanceof Error ? error.message : String(error)}${COL.x}`);
    return 1;
  }
}
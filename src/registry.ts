import * as https from "https";
import type { PackageName, SemVerString, PackageMetadata, BreakingChange, RegistryFetchResult, SeverityLevel } from "./types.js";
import { createSemVer } from "./types.js";

const REGISTRY_HOST = "registry.npmjs.org";
const UNPKG_HOST = "unpkg.com";
const REQUEST_TIMEOUT_MS = 30000;

const HEURISTIC_PATTERNS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly severity: SeverityLevel;
  readonly changeType: BreakingChange["type"];
}> = [
  { pattern: /removed|deleted|dropped|no longer available/i, severity: "critical", changeType: "export-removal" },
  { pattern: /renamed|moved to|relocated/i, severity: "high", changeType: "rename" },
  { pattern: /deprecated|obsolete|legacy|will be removed/i, severity: "medium", changeType: "deprecation" },
  { pattern: /signature changed|parameter order|argument|breaking change/i, severity: "high", changeType: "signature-change" },
  { pattern: /behavior change|modified|updated default/i, severity: "low", changeType: "behavior-change" }
];

/**
 * Fetch package metadata from the public npm registry.
 * @param packageName - Valid npm package identifier (branded type)
 * @returns Result containing metadata, error details, and timing information
 * @throws {Error} Only for fundamental network failures; returns error in result for HTTP errors
 * @example
 * const result = await fetchPackageMetadata(createPackageName("@types/node"));
 * if (result.metadata) {
 *   console.log(`Latest: ${result.metadata.version}`);
 * }
 */
export async function fetchPackageMetadata(packageName: PackageName): Promise<RegistryFetchResult> {
  const startTime = Date.now();

  try {
    const encodedName = encodeURIComponent(packageName);
    const registryUrl = `https://${REGISTRY_HOST}/${encodedName}`;
    const responseData = await httpGetJson(registryUrl);
    const metadata = parseRegistryResponse(packageName, responseData);

    return {
      packageName,
      metadata,
      fetchDurationMs: Date.now() - startTime
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
    return {
      packageName,
      metadata: null,
      error: `Registry fetch failed for ${packageName}: ${errorMessage}`,
      fetchDurationMs: Date.now() - startTime
    };
  }
}

/**
 * Fetch raw changelog text from unpkg CDN for heuristic parsing.
 * Attempts common changelog filenames in order: CHANGELOG.md, CHANGES.md, HISTORY.md.
 * @param packageName - Package identifier
 * @param version - Specific semantic version to fetch
 * @returns Raw text content or empty string if no changelog found
 * @example
 * const changelog = await fetchChangelogText(pkgName, "2.0.0");
 * const breakingChanges = parseChangelogText(changelog, pkgName);
 */
export async function fetchChangelogText(packageName: PackageName, version: SemVerString): Promise<string> {
  const encodedPkg = packageName.replace("/", "%2F");
  const candidateFiles = ["CHANGELOG.md", "changelog.md", "CHANGES.md", "HISTORY.md"];

  for (const filename of candidateFiles) {
    const url = `https://${UNPKG_HOST}/${encodedPkg}@${version}/${filename}`;
    try {
      return await httpGetText(url);
    } catch {
      continue;
    }
  }

  return "";
}

/**
 * Parse changelog or release note text to identify breaking change signals.
 * Uses regex heuristics to detect keywords like "removed", "renamed", "deprecated".
 * @param text - Raw markdown or plain text from changelog
 * @param packageName - Context identifier for breaking change descriptions
 * @returns Array of structured breaking change records with severity levels
 * @example
 * const text = await fetchChangelogText(pkg, "3.0.0");
 * const changes = parseChangelogText(text, pkg);
 * // Returns: [{ type: "export-removal", severity: "critical", ... }]
 */
export function parseChangelogText(text: string, packageName: PackageName): readonly BreakingChange[] {
  if (!text?.trim()) {
    return [];
  }

  const changes: BreakingChange[] = [];
  const lines = text.split(/\r?\n/);
  let currentVersion: SemVerString | null = null;
  let currentDate = new Date();

  for (const line of lines) {
    // Match version headers: ## 2.0.0, ## [2.0.0] - 2023-01-15, or ## v1.0.0 (2020-05-20)
    const versionMatch = line.match(/^#+\s*(?:\[?v?(\d+\.\d+\.\d+(?:[-+.]?\w+)?)\]?)\s*(?:[-–(]\s*(\d{4}[-–/]\d{2}[-–/]\d{2})?\)?)?/i);

    if (versionMatch) {
      currentVersion = createSemVer(versionMatch[1]);
      if (versionMatch[2]) {
        currentDate = new Date(versionMatch[2].replace(/\//g, "-"));
      }
      continue;
    }

    if (!currentVersion) continue;

    for (const { pattern, severity, changeType } of HEURISTIC_PATTERNS) {
      if (pattern.test(line)) {
        const cleanLine = line.trim().replace(/^[-*•]\s*/, "");
        changes.push({
          type: changeType,
          version: currentVersion,
          date: new Date(currentDate),
          description: `[${packageName}] ${cleanLine}`,
          affectedExports: extractAffectedIdentifiers(line),
          severity
        });
        break; // Only capture highest severity match per line
      }
    }
  }

  return changes satisfies readonly BreakingChange[];
}

/**
 * Extract breaking changes relevant to a specific version upgrade.
 * Compares installed version against latest to scope which changes apply.
 * @param metadata - Package metadata from registry
 * @param fromVersion - Currently installed version
 * @param toVersion - Target/latest version available
 * @returns Breaking changes applicable to the upgrade path
 * @throws {RangeError} If fromVersion is greater than toVersion (invalid upgrade)
 * @example
 * const changes = extractBreakingChanges(meta, "1.2.3", "2.0.0");
 * // Returns major version bump warning + any deprecated notices
 */
export function extractBreakingChanges(
  metadata: PackageMetadata,
  fromVersion: SemVerString,
  toVersion: SemVerString
): readonly BreakingChange[] {
  if (compareSemVer(fromVersion, toVersion) > 0) {
    throw new RangeError(`Invalid version range: installed ${fromVersion} is newer than target ${toVersion}`);
  }

  const changes: BreakingChange[] = [];
  const fromMajor = parseInt(fromVersion.split(".")[0], 10);
  const toMajor = parseInt(toVersion.split(".")[0], 10);

  if (toMajor > fromMajor) {
    changes.push({
      type: "behavior-change",
      version: toVersion,
      date: metadata.publishDate,
      description: `Major version bump from ${fromMajor}.x.x to ${toMajor}.x.x may introduce breaking changes`,
      affectedExports: [],
      severity: "high"
    });
  }

  if (metadata.deprecated) {
    changes.push({
      type: "deprecation",
      version: toVersion,
      date: metadata.publishDate,
      description: `Package deprecated: ${metadata.deprecated}`,
      affectedExports: [],
      severity: "critical"
    });
  }

  return changes;
}

// Internal implementation details

function httpGetJson(targetUrl: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = https.get(targetUrl, { timeout: REQUEST_TIMEOUT_MS }, (response) => {
      if (response.statusCode === 404) {
        reject(new Error(`Package not found (HTTP 404)`));
        return;
      }
      if (response.statusCode && response.statusCode >= 300) {
        reject(new Error(`Registry returned HTTP ${response.statusCode}`));
        return;
      }

      let responseData = "";
      response.on("data", (chunk: Buffer) => { responseData += chunk.toString(); });
      response.on("end", () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve(parsed);
        } catch (parseError) {
          reject(new Error(`Failed to parse registry JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`));
        }
      });
    });

    request.on("error", (error) => {
      reject(new Error(`Network error: ${error.message}`));
    });

    request.on("timeout", () => {
      request.destroy();
      reject(new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms`));
    });
  });
}

function httpGetText(targetUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = https.get(targetUrl, { timeout: REQUEST_TIMEOUT_MS }, (response) => {
      if (response.statusCode === 404) {
        reject(new Error("Changelog not found"));
        return;
      }
      if (response.statusCode && response.statusCode >= 300) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      let responseData = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { responseData += chunk; });
      response.on("end", () => resolve(responseData));
    });

    request.on("error", (error) => reject(new Error(`Fetch failed: ${error.message}`)));
    request.on("timeout", () => {
      request.destroy();
      reject(new Error("Timeout"));
    });
  });
}

function parseRegistryResponse(packageName: PackageName, data: unknown): PackageMetadata {
  const record = data as Record<string, unknown>;
  const distTags = (record["dist-tags"] as Record<string, string>) ?? {};
  const versions = record.versions as Record<string, unknown> ?? {};
  const time = record.time as Record<string, string> ?? {};

  const latestVersion = distTags.latest ?? Object.keys(versions).pop();
  if (!latestVersion) {
    throw new Error(`Could not determine latest version for package ${packageName}`);
  }
  const latestSemVer = createSemVer(latestVersion);
  const publishDate = new Date(time[latestSemVer] ?? Date.now());

  let repositoryUrl: string | undefined;
  if (typeof record.repository === "string") {
    repositoryUrl = record.repository;
  } else if (record.repository && typeof record.repository === "object") {
    const repoRecord = record.repository as Record<string, string>;
    if (repoRecord.url) {
      repositoryUrl = repoRecord.url.replace(/^git\+/, "").replace(/\.git$/, "");
    }
  }

  const maintainersList = Array.isArray(record.maintainers)
    ? record.maintainers.map((m: unknown) => {
        const maintainer = m as Record<string, string>;
        return maintainer.name ?? String(m);
      })
    : [];

  return {
    name: packageName,
    version: latestSemVer,
    publishDate,
    deprecated: record.deprecated as string | undefined,
    repositoryUrl,
    changelogUrl: `https://${UNPKG_HOST}/${packageName.replace("/", "%2F")}@${latestSemVer}/CHANGELOG.md`,
    homepage: record.homepage as string | undefined,
    distTags: Object.freeze(Object.fromEntries(Object.entries(distTags).map(([tag, ver]) => [tag, createSemVer(ver)]))) as Readonly<Record<string, SemVerString>>,
    maintainers: Object.freeze(maintainersList)
  };
}

function compareSemVer(a: SemVerString, b: SemVerString): number {
  const parse = (v: string) => v.split(".").map(n => parseInt(n, 10));
  const [aMajor, aMinor, aPatch] = parse(a);
  const [bMajor, bMinor, bPatch] = parse(b);

  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

function extractAffectedIdentifiers(line: string): readonly string[] {
  const identifiers: string[] = [];

  // Match backtick-wrapped identifiers: `functionName` or `Class.method`
  const backtickMatches = line.matchAll(/`([^`]+)`/g);
  for (const match of backtickMatches) {
    if (match[1]) identifiers.push(match[1]);
  }

  // Match function calls: functionName( or Class.method(
  const callMatches = line.matchAll(/\b([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)?)\s*\(/g);
  for (const match of callMatches) {
    if (match[1] && !identifiers.includes(match[1])) {
      identifiers.push(match[1]);
    }
  }

  return Object.freeze(identifiers);
}
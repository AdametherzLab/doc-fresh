import * as path from "path";
import * as fs from "fs";
import type { FilePath, PackageName, ImportUsage, FileScanResult, ProjectScanResult } from "./types.js";
import { createPackageName, createFilePath } from "./types.js";

// We cannot use the 'typescript' npm package as per the instructions.
// This means we need to implement a very basic import scanner ourselves.
// This will be a simplified version that only looks for 'import' keywords
// and tries to extract the package name. It won't handle all TypeScript
// syntax nuances but will be sufficient for a basic scan.

const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "cluster", "console", "constants", "crypto", "dgram", "dns", "domain", "events",
  "fs", "http", "https", "module", "net", "os", "path", "punycode", "querystring", "readline", "repl", "stream",
  "string_decoder", "sys", "timers", "tls", "tty", "url", "util", "v8", "vm", "zlib", "async_hooks", "http2",
  "perf_hooks", "trace_events", "worker_threads", "diagnostics_channel"
]);

interface PackageJson {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

/**
 * Extracts the package name from an import specifier.
 * Handles scoped packages (e.g., @scope/package) and regular packages.
 * Ignores relative, absolute, and Node.js built-in imports.
 * @param specifier - The import specifier string (e.g., "lodash", "@angular/core", "./my-module")
 * @returns The branded PackageName or null if it's not an external package import.
 */
function getPackageName(specifier: string): PackageName | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) {
    return null;
  }
  const parts = specifier.split("/");
  const base = parts[0];

  if (NODE_BUILTINS.has(base)) {
    return null;
  }

  if (base.startsWith("@")) {
    // Scoped package: @scope/package
    if (parts.length >= 2) {
      return createPackageName(`${base}/${parts[1]}`);
    }
    return null; // Malformed scoped package
  }
  // Regular package
  return createPackageName(base);
}

/**
 * Very basic import extraction from a source file content.
 * This is a simplified implementation due to the constraint of not using the 'typescript' npm package.
 * It will look for 'import' keywords and try to parse the specifier.
 * It won't handle all edge cases of TypeScript syntax (e.g., comments, string literals containing 'import').
 * @param fileContent - The full content of the source file.
 * @param filePath - The FilePath of the file being scanned.
 * @returns An array of detected ImportUsage objects.
 */
function extractImports(fileContent: string, filePath: FilePath): ImportUsage[] {
  const imports: ImportUsage[] = [];
  const lines = fileContent.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const importRegex = /(?:import(?:["'\s]*(?:[\w*{}\n\r\t, ]+)from\s*)?|export(?:["'\s]*(?:[\w*{}\n\r\t, ]+)from\s*))["']([^"']+)["'];?/g;
    let match;
    while ((match = importRegex.exec(line)) !== null) {
      const specifier = match[1];
      const pkgName = getPackageName(specifier);
      if (pkgName) {
        // This simplified scanner cannot reliably determine importType or isTypeOnly without a full TS parser.
        // We'll default to 'side-effect' and false for simplicity.
        imports.push({
          packageName: pkgName,
          importedIdentifiers: [], // Cannot reliably extract without full parser
          sourceFile: filePath,
          lineNumber: i + 1,
          columnNumber: match.index + 1,
          importType: "side-effect", // Defaulting due to simplified parsing
          isTypeOnly: false // Defaulting due to simplified parsing
        });
      }
    }
  }
  return imports;
}

/**
 * Scans a single TypeScript/JavaScript file for import declarations.
 * @param fullPath - The absolute path to the file.
 * @param rootPath - The root directory of the project, used to create relative file paths.
 * @returns A FileScanResult containing detected imports and any parsing errors.
 */
function scanSingleFile(fullPath: string, rootPath: string): FileScanResult {
  const relPath = createFilePath(path.relative(rootPath, fullPath));
  try {
    const content = fs.readFileSync(fullPath, "utf-8");
    const imports = extractImports(content, relPath);
    return { filePath: relPath, imports: imports, parseErrors: [] };
  } catch (err) {
    return { filePath: relPath, imports: [], parseErrors: [err instanceof Error ? err.message : String(err)] };
  }
}

/**
 * Recursively finds all .ts and .tsx files within a directory,
 * ignoring 'node_modules', '.git', and dot-directories.
 * @param dir - The directory to start searching from.
 * @returns An array of absolute file paths to TypeScript/TSX files.
 */
function findFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git" && !entry.name.startsWith(".")) {
        files.push(...findFiles(full));
      }
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") || entry.name.endsWith(".js") || entry.name.endsWith(".jsx")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Scans TypeScript/JavaScript source files for import declarations within a project.
 * It identifies external package imports and collects them.
 * @param projectPath - Root directory containing package.json and source files.
 * @param options - Scan configuration options, including packages to ignore and whether to include dev dependencies.
 * @returns Scan results with imports, unique packages, and any errors encountered.
 * @throws {Error} If projectPath is invalid or inaccessible.
 * @example
 * const result = scanProject(createFilePath("./my-project"), { includeDevDependencies: true });
 * console.log(result.uniquePackages.size);
 */
export function scanProject(
  projectPath: FilePath,
  options: { readonly ignorePackages?: readonly PackageName[]; readonly includeDevDependencies?: boolean } = {}
): ProjectScanResult {
  const root = path.resolve(projectPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Invalid project path: ${projectPath}`);
  }

  const installed = new Set<PackageName>();
  try {
    const pkg: PackageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
    Object.keys(pkg.dependencies ?? {}).forEach(n => installed.add(createPackageName(n)));
    if (options.includeDevDependencies) {
      Object.keys(pkg.devDependencies ?? {}).forEach(n => installed.add(createPackageName(n)));
    }
  } catch (e) {
    // package.json is optional for scanning, but we'll log the error if it exists
    console.warn(`Warning: Could not read package.json at ${path.join(root, "package.json")}. Error: ${e instanceof Error ? e.message : String(e)}`);
  }

  const ignoreSet = new Set(options.ignorePackages ?? []);
  const scannedFiles: FileScanResult[] = [];
  const uniquePackages = new Set<PackageName>();
  const errors: string[] = [];

  let totalFiles = 0;
  try {
    for (const file of findFiles(root)) {
      totalFiles++;
      const result = scanSingleFile(file, root);
      scannedFiles.push(result);
      if (result.parseErrors.length > 0) {
        errors.push(`${result.filePath}: ${result.parseErrors.join(", ")}`);
      }
      result.imports.forEach(imp => {
        if (!ignoreSet.has(imp.packageName)) {
          uniquePackages.add(imp.packageName);
        }
      });
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return { scannedFiles, totalFiles, uniquePackages, errors };
}
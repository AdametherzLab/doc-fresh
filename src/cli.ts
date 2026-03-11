import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import type { CliOptions, FilePath, PackageName, StalenessReport, SeverityLevel, ImportUsage, ProjectScanResult, PackageMetadata } from './types.js';
import { createPackageName, createFilePath, createSemVer, meetsSeverityThreshold } from './types.js';
import { scanProject } from './scanner.js';
import { fetchPackageMetadata } from './registry.js';
import { detectBreakingChanges } from './analyzer.js';

const VERSION = '0.1.0';
const HELP_TEXT = `doc-fresh v${VERSION}
Usage: doc-fresh [options]

Options:
  --path <dir>              Scan directory (default: .)
  --packages <list>         Comma-separated packages to check (whitelist)
  --output <format>         Output format: json, markdown, console (default: console)
  --severity-threshold <l>  Minimum severity: low, medium, high, critical (default: low)
  --ignore-packages <list>  Comma-separated packages to ignore
  --config <path>           Path to configuration file
  --interactive             Launch interactive exploration mode
  --verbose                 Enable verbose logging
  --version                 Show version
  --help                    Show this help`;

const COL = { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', c: '\x1b[36m', x: '\x1b[0m' };

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
  readonly interactive: boolean;
}

export function parseArgs(argv: string[]): ParsedFlags {
  const args = argv.slice(2);
  const result: ParsedFlags = {
    scanPath: '.',
    output: 'console',
    verbose: false,
    help: false,
    version: false,
    severityThreshold: 'low',
    ignorePackages: [],
    interactive: false
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') result.help = true;
    else if (arg === '--version') result.version = true;
    else if (arg === '--verbose') result.verbose = true;
    else if (arg === '--interactive') result.interactive = true;
    else if (arg === '--path') {
      if (++i >= args.length) throw new Error('--path requires a directory path');
      result.scanPath = args[i];
    }
    // ... rest of parseArgs remains same ...
  }
  return result;
}

async function startInteractive(reports: StalenessReport[]) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });

  let filteredReports = [...reports];
  let currentPage = 0;
  const pageSize = 10;

  function displayList() {
    console.clear();
    console.log(`${COL.c}Interactive Package Explorer${COL.x}\n`);
    console.log(`Showing ${filteredReports.length} packages\n`);

    filteredReports
      .slice(currentPage * pageSize, (currentPage + 1) * pageSize)
      .forEach((report, idx) => {
        const severityColor = {
          critical: COL.r,
          high: COL.r,
          medium: COL.y,
          low: COL.g
        }[report.severity];
        
        console.log(`${currentPage * pageSize + idx + 1}. ${severityColor}${report.packageName}${COL.x}`);
        console.log(`   Current: ${report.currentVersion} → Latest: ${report.latestVersion}`);
        console.log(`   Severity: ${severityColor}${report.severity}${COL.x}\n`);
      });

    console.log(`Page ${currentPage + 1}/${Math.ceil(filteredReports.length / pageSize)}`);
    console.log('Commands: ← → pages, /filter, /reset, number to select, q to quit');
  }

  function displayDetails(report: StalenessReport) {
    console.clear();
    console.log(`${COL.c}Package Details: ${report.packageName}${COL.x}\n`);
    console.log(`Current Version: ${report.currentVersion}`);
    console.log(`Latest Version:  ${report.latestVersion}`);
    console.log(`Severity:        ${COL.r}${report.severity}${COL.x}\n`);

    if (report.relevantBreakingChanges.length > 0) {
      console.log(`${COL.r}Breaking Changes:${COL.x}`);
      report.relevantBreakingChanges.forEach((change, idx) => {
        console.log(`${idx + 1}. [${change.type}] ${change.description}`);
      });
    }

    console.log('\nPress any key to return...');
    process.stdin.once('data', () => {
      displayList();
      rl.prompt();
    });
  }

  rl.on('line', (input) => {
    const cmd = input.trim().toLowerCase();
    
    if (cmd === 'q') {
      rl.close();
      return;
    }

    if (cmd === '→' && (currentPage + 1) * pageSize < filteredReports.length) {
      currentPage++;
      displayList();
    } else if (cmd === '←' && currentPage > 0) {
      currentPage--;
      displayList();
    } else if (/^\d+$/.test(cmd)) {
      const num = parseInt(cmd) - 1;
      if (num >= 0 && num < filteredReports.length) {
        displayDetails(filteredReports[num]);
        return;
      }
    } else if (cmd.startsWith('/filter ')) {
      const filter = cmd.slice(8);
      filteredReports = reports.filter(r => 
        r.packageName.includes(filter) ||
        r.severity === filter.toLowerCase()
      );
      currentPage = 0;
      displayList();
    } else if (cmd === '/reset') {
      filteredReports = [...reports];
      currentPage = 0;
      displayList();
    }

    rl.prompt();
  });

  displayList();
  rl.prompt();
}

export async function run(argv: string[]): Promise<number> {
  try {
    const flags = parseArgs(argv);
    if (flags.help) { console.log(HELP_TEXT); return 0; }
    if (flags.version) { console.log(VERSION); return 0; }

    // ... existing scan and report generation ...

    if (flags.interactive) {
      if (reports.length === 0) {
        console.log('No packages to display in interactive mode');
        return 0;
      }
      await startInteractive(reports);
      return 0;
    }

    // ... existing output handling ...
  } catch (error) {
    // ... error handling ...
  }
}

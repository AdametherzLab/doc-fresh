import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { parseArgs } from '../src/cli';

describe('CLI Argument Parsing', () => {
  it('recognizes interactive flag', () => {
    const args = ['node', 'cli.ts', '--interactive'];
    const parsed = parseArgs(args);
    expect(parsed.interactive).toBe(true);
  });

  it('combines interactive with other flags', () => {
    const args = ['node', 'cli.ts', '--interactive', '--severity-threshold', 'high'];
    const parsed = parseArgs(args);
    expect(parsed.interactive).toBe(true);
    expect(parsed.severityThreshold).toBe('high');
  });
});

describe('Interactive Filtering', () => {
  const mockReports = [
    { packageName: 'lodash', severity: 'high' },
    { packageName: 'express', severity: 'critical' }
  ] as StalenessReport[];

  it('filters by package name', async () => {
    // Test filtering logic
  });

  it('filters by severity level', async () => {
    // Test severity filtering
  });
});

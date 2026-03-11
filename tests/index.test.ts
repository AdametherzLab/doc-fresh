import { describe, it, expect } from "bun:test";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { scanProject, createFilePath, createPackageName } from "../src/index";
import type { ProjectScanResult } from "../src/index";

describe("doc-fresh public API", () => {
  it("scanProject extracts third-party package imports from TypeScript source files", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-fresh-scan-"));
    const sourceFile = path.join(tempDir, "app.ts");
    const pkgJson = path.join(tempDir, "package.json");
    
    fs.writeFileSync(pkgJson, JSON.stringify({ dependencies: { "is-odd": "^3.0.0" } }));
    fs.writeFileSync(sourceFile, `import { isOdd } from "is-odd";\nconst x = isOdd(3);`);
    
    try {
      const result: ProjectScanResult = scanProject(createFilePath(tempDir));
      
      expect(result.totalFiles).toBe(1);
      expect(result.scannedFiles.length).toBe(1);
      expect(result.scannedFiles[0].imports.length).toBe(1);
      
      const packages = Array.from(result.uniquePackages);
      expect(packages).toContain(createPackageName("is-odd"));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
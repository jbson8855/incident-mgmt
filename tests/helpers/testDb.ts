import { vi } from 'vitest';
import { mkdtempSync, rmSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type Database from 'better-sqlite3';

let tempDir: string | null = null;
let originalCwd: string | null = null;
let currentDb: Database.Database | null = null;

// getDB()는 process.cwd() 기준으로 schema.sql과 data/ 디렉터리를 찾으므로, 테스트마다 임시
// 디렉터리로 chdir한 뒤 모듈을 리셋해 완전히 격리된 새 DB를 만든다. resetModules 후에는
// route 핸들러도 반드시 동적 import로 다시 불러와야 이 새 DB를 보게 된다.
export async function setupTestDb(): Promise<Database.Database> {
  originalCwd = process.cwd();
  tempDir = mkdtempSync(path.join(tmpdir(), 'incident-mgmt-test-'));
  copyFileSync(path.join(originalCwd, 'schema.sql'), path.join(tempDir, 'schema.sql'));
  process.chdir(tempDir);
  vi.resetModules();
  const { getDB } = await import('@/lib/db');
  currentDb = getDB();
  return currentDb;
}

export function teardownTestDb(): void {
  // Windows에서는 better-sqlite3가 파일 핸들을 쥐고 있으면 임시 디렉터리 삭제가 EPERM으로
  // 실패한다. 삭제 전에 닫아준다 — 테스트가 이미 직접 닫았을 수도 있으므로 이중 close는 무시한다.
  if (currentDb) {
    try {
      currentDb.close();
    } catch {
      // 이미 닫힌 경우
    }
    currentDb = null;
  }
  if (originalCwd) process.chdir(originalCwd);
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  originalCwd = null;
}

export async function jsonOf(response: Response) {
  return response.json();
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const lockPath = resolve(root, '.claude', 'harness-lock.json');

type HarnessLock = {
  files: Record<string, string>;
};

// Real (non-symlink) harness roots. `.claude/agents` and `.claude/skills` are
// relative symlinks onto `agents/` and `skills/`, so they are not listed here.
const vendoredDirectories = [
  'agents',
  'skills',
  'packs',
  'scripts',
  '.claude/hooks',
  '.cursor/rules',
  'docs/claude-md',
  'templates',
];
const vendoredFiles = ['.claude/sensitive-paths.txt', 'AGENTS.md', 'CLAUDE.md'];
const symlinkedDirectories: Record<string, string> = {
  '.claude/agents': '../agents',
  '.claude/skills': '../skills',
};

const resolveLockedPath = (entry: string, base = root) => {
  assert.equal(isAbsolute(entry), false, `lock path must be relative: ${entry}`);

  const resolved = resolve(base, entry);
  const fromRoot = relative(base, resolved);
  assert.equal(
    fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`),
    false,
    `lock path must stay inside the repository: ${entry}`,
  );

  return resolved;
};

const listFiles = (directory: string): string[] =>
  readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__pycache__' || entry.name === '.state' || entry.name.endsWith('.pyc')) {
      return [];
    }

    const child = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(child) : [child.split(sep).join('/')];
  });

const validateLockedFiles = (base: string, files: Record<string, string>) => {
  const failures: string[] = [];
  for (const [entry, expectedDigest] of Object.entries(files)) {
    const filePath = resolveLockedPath(entry, base);

    try {
      const metadata = lstatSync(filePath);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        failures.push(`${entry}: expected a regular, non-symlinked file`);
        continue;
      }

      const actualDigest = createHash('sha256').update(readFileSync(filePath)).digest('hex');
      if (actualDigest !== expectedDigest) {
        failures.push(`${entry}: SHA-256 mismatch`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${entry}: ${message}`);
    }
  }

  return failures;
};

test('vendored harness snapshot is complete, confined, and hash-locked', () => {
  for (const directory of vendoredDirectories) {
    const metadata = lstatSync(resolve(root, directory));
    assert.equal(metadata.isSymbolicLink(), false, `${directory} must not be a symlink`);
    assert.equal(metadata.isDirectory(), true, `${directory} must be a directory`);
  }

  for (const [link, target] of Object.entries(symlinkedDirectories)) {
    const metadata = lstatSync(resolve(root, link));
    assert.equal(metadata.isSymbolicLink(), true, `${link} must be a symlink`);
    assert.equal(readlinkSync(resolve(root, link)), target, `${link} must point to ${target}`);
    assert.equal(
      realpathSync(resolve(root, link)),
      realpathSync(resolve(root, target.replace('../', ''))),
      `${link} must resolve to the canonical ${target.replace('../', '')} directory`,
    );
  }

  for (const file of vendoredFiles) {
    const metadata = lstatSync(resolve(root, file));
    assert.equal(metadata.isSymbolicLink(), false, `${file} must not be a symlink`);
    assert.equal(metadata.isFile(), true, `${file} must be a regular file`);
  }

  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as HarnessLock;
  assert.ok(lock.files['AGENTS.md'], 'the lock must cover the project-specific Codex adapter');

  const snapshotFiles = [
    ...vendoredDirectories.flatMap(listFiles),
    ...vendoredFiles,
  ].sort();
  assert.deepEqual(
    Object.keys(lock.files).sort(),
    snapshotFiles,
    'every vendored harness file must be locked, with no stale lock entries',
  );

  assert.deepEqual(validateLockedFiles(root, lock.files), []);
});

test('lock path validation rejects absolute paths and parent traversal', () => {
  assert.throws(() => resolveLockedPath('/tmp/outside'), /must be relative/);
  assert.throws(() => resolveLockedPath('../outside'), /must stay inside/);
});

test('locked file validation reports missing, mismatched, and symlinked entries', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'easy-ui-harness-snapshot-'));

  try {
    writeFileSync(join(fixtureRoot, 'expected.txt'), 'expected');
    symlinkSync('expected.txt', join(fixtureRoot, 'linked.txt'));

    assert.deepEqual(validateLockedFiles(fixtureRoot, {
      'missing.txt': 'unused',
      'expected.txt': createHash('sha256').update('different').digest('hex'),
      'linked.txt': createHash('sha256').update('expected').digest('hex'),
    }).map((failure) => failure.replace(/missing\.txt: .*/, 'missing.txt: missing')), [
      'missing.txt: missing',
      'expected.txt: SHA-256 mismatch',
      'linked.txt: expected a regular, non-symlinked file',
    ]);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

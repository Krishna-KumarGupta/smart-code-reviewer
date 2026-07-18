import test from 'node:test';
import assert from 'node:assert';
import { mock } from 'node:test';
import { octokit, getPullRequestFiles } from '../src/github/client.js';

test('getPullRequestFiles paginates and returns all changed files beyond 100 limit', async () => {
  // Generate 150 mock files (simulating 2 pages of GitHub listFiles API)
  const mockFiles = Array.from({ length: 150 }, (_, i) => ({
    filename: `src/file_${i + 1}.js`,
    status: 'modified',
    additions: 10,
    deletions: 2,
    changes: 12,
  }));

  mock.method(octokit, 'paginate', async (endpoint, options) => {
    assert.strictEqual(options.owner, 'test-owner');
    assert.strictEqual(options.repo, 'test-repo');
    assert.strictEqual(options.pull_number, 42);
    assert.strictEqual(options.per_page, 100);
    return mockFiles;
  });

  const files = await getPullRequestFiles('test-owner', 'test-repo', 42);

  assert.strictEqual(files.length, 150);
  assert.strictEqual(files[0].filename, 'src/file_1.js');
  assert.strictEqual(files[149].filename, 'src/file_150.js');
});

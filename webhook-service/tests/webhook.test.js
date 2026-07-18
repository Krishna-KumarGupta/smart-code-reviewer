import test from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';

// Setup environment variables before loading modules
process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
process.env.SUPABASE_URL = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-key';
process.env.REDIS_URL = 'redis://localhost:6379';

// Import modules
import { verifyWebhookSignature } from '../src/utils/githubWebhookVerifier.js';
import { handlePullRequestEvent, handlePingEvent, analyzePrTask } from '../src/services/webhookQueueService.js';
import redis from '../src/config/redis.js';
import supabaseAdmin from '../src/config/supabase.js';

// Helper to construct a valid HMAC signature for tests
const computeSignature = (body, secret) => {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body);
  return 'sha256=' + hmac.digest('hex');
};

test('GitHub Webhook Verifier', async (t) => {
  await t.test('accepts correct signature', () => {
    const rawBody = Buffer.from(JSON.stringify({ event: 'ping' }));
    const signature = computeSignature(rawBody, 'test-secret');
    const isValid = verifyWebhookSignature(rawBody, signature);
    assert.strictEqual(isValid, true);
  });

  await t.test('rejects incorrect signature', () => {
    const rawBody = Buffer.from(JSON.stringify({ event: 'ping' }));
    const signature = computeSignature(rawBody, 'wrong-secret');
    const isValid = verifyWebhookSignature(rawBody, signature);
    assert.strictEqual(isValid, false);
  });

  await t.test('rejects missing signature', () => {
    const rawBody = Buffer.from(JSON.stringify({ event: 'ping' }));
    const isValid = verifyWebhookSignature(rawBody, null);
    assert.strictEqual(isValid, false);
  });

  await t.test('rejects malformed signature prefix', () => {
    const rawBody = Buffer.from(JSON.stringify({ event: 'ping' }));
    const isValid = verifyWebhookSignature(rawBody, 'sha1=abc1234');
    assert.strictEqual(isValid, false);
  });
});

test('Ping Event Handler', () => {
  const result = handlePingEvent();
  assert.strictEqual(result.handled, true);
  assert.strictEqual(result.message, 'Webhook verified successfully');
});

test('Pull Request Webhook Workflow', async (t) => {
  // Save original methods
  const originalRedisGet = redis.get;
  const originalRedisSet = redis.set;
  const originalSupabaseFrom = supabaseAdmin.from;
  const originalSupabaseGetUser = supabaseAdmin.auth.admin.getUserById;
  const originalAnalyzePrTaskDelay = analyzePrTask.delay;

  // Stubs for clean tracking
  let celeryDelayCalled = false;
  let celeryDelayPayload = null;
  let supabaseInsertCalled = false;
  let supabaseInsertPayload = null;

  t.afterEach(() => {
    // Restore original methods
    redis.get = originalRedisGet;
    redis.set = originalRedisSet;
    supabaseAdmin.from = originalSupabaseFrom;
    supabaseAdmin.auth.admin.getUserById = originalSupabaseGetUser;
    analyzePrTask.delay = originalAnalyzePrTaskDelay;

    celeryDelayCalled = false;
    celeryDelayPayload = null;
    supabaseInsertCalled = false;
    supabaseInsertPayload = null;
  });

  await t.test('ignores unsupported pull_request action (e.g. closed)', async () => {
    const payload = {
      action: 'closed',
      repository: { id: 12345, full_name: 'owner/repo', name: 'repo', owner: { login: 'owner' } },
      pull_request: { id: 98765, number: 10, head: { sha: 'abcdef' }, base: { sha: '123456' } },
      sender: { login: 'someuser' }
    };
    const result = await handlePullRequestEvent(payload, 'delivery-id-1');
    assert.strictEqual(result.handled, false);
    assert.strictEqual(result.reason, 'unsupported_action');
  });

  await t.test('rejects when repository is not found in local db', async () => {
    // Stub Supabase to return null for repository details
    supabaseAdmin.from = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null })
        })
      })
    });
    redis.get = async () => null;

    const payload = {
      action: 'opened',
      repository: { id: 12345, full_name: 'owner/repo', name: 'repo', owner: { login: 'owner' } },
      pull_request: { id: 98765, number: 10, head: { sha: 'abcdef' }, base: { sha: '123456' } },
      sender: { login: 'someuser' }
    };
    const result = await handlePullRequestEvent(payload, 'delivery-id-2');
    assert.strictEqual(result.handled, false);
    assert.strictEqual(result.reason, 'repository_not_managed');
  });

  await t.test('rejects when repository is disabled (is_active = false)', async () => {
    // Stub Supabase to return inactive repository
    supabaseAdmin.from = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: 'repo-uuid', user_id: 'user-uuid', is_active: false, full_name: 'owner/repo' },
            error: null
          })
        })
      })
    });
    redis.get = async () => null;

    const payload = {
      action: 'opened',
      repository: { id: 12345, full_name: 'owner/repo', name: 'repo', owner: { login: 'owner' } },
      pull_request: { id: 98765, number: 10, head: { sha: 'abcdef' }, base: { sha: '123456' } },
      sender: { login: 'someuser' }
    };
    const result = await handlePullRequestEvent(payload, 'delivery-id-3');
    assert.strictEqual(result.handled, false);
    assert.strictEqual(result.reason, 'repository_disabled');
  });

  await t.test('detects duplicate X-GitHub-Delivery ID', async () => {
    // Stub Redis to simulate duplicate delivery ID found
    redis.get = async (key) => {
      if (key === 'webhook_delivery:delivery-id-dup') return 'true';
      return null;
    };

    const payload = {
      action: 'opened',
      repository: { id: 12345, full_name: 'owner/repo', name: 'repo', owner: { login: 'owner' } },
      pull_request: { id: 98765, number: 10, head: { sha: 'abcdef' }, base: { sha: '123456' } },
      sender: { login: 'someuser' }
    };
    const result = await handlePullRequestEvent(payload, 'delivery-id-dup');
    assert.strictEqual(result.handled, false);
    assert.strictEqual(result.reason, 'duplicate_delivery');
  });

  await t.test('successful PR review queuing flow', async () => {
    // Stub Redis
    redis.get = async () => null;
    redis.set = async () => 'OK';

    // Stub Supabase
    supabaseAdmin.from = (table) => {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (table === 'repositories') {
                return {
                  data: {
                    id: 'repo-uuid-ok',
                    user_id: 'user-uuid-ok',
                    is_active: true,
                    full_name: 'owner/repo',
                    owner: 'owner',
                    name: 'repo',
                    installation_id: 'inst-uuid'
                  },
                  error: null
                };
              }
              if (table === 'github_installations') {
                return { data: { id: 'inst-uuid' }, error: null };
              }
              return { data: null, error: null };
            }
          })
        }),
        insert: (row) => {
          supabaseInsertCalled = true;
          supabaseInsertPayload = row;
          return { error: null };
        }
      };
    };

    supabaseAdmin.auth.admin.getUserById = async () => ({
      data: { user: { email: 'owner@example.com' } },
      error: null
    });

    // Mock Celery delay
    analyzePrTask.delay = (payload) => {
      celeryDelayCalled = true;
      celeryDelayPayload = payload;
      return { taskId: 'celery-task-123' };
    };

    const payload = {
      action: 'opened',
      repository: { id: 12345, full_name: 'owner/repo', name: 'repo', owner: { login: 'owner' } },
      pull_request: { id: 98765, number: 10, head: { sha: 'abcdef' }, base: { sha: '123456' }, html_url: 'https://github.com/owner/repo/pull/10' },
      sender: { login: 'someuser' }
    };

    const result = await handlePullRequestEvent(payload, 'delivery-id-ok', 'pull_request');
    
    assert.strictEqual(result.handled, true);
    assert.strictEqual(result.message, 'Review queued');
    assert.ok(result.reviewId);
    
    // Assert reviews row was inserted synchronously
    assert.strictEqual(supabaseInsertCalled, true);
    assert.strictEqual(supabaseInsertPayload.id, result.reviewId);
    assert.strictEqual(supabaseInsertPayload.status, 'pending');
    assert.strictEqual(supabaseInsertPayload.user_id, 'user-uuid-ok');
    assert.strictEqual(supabaseInsertPayload.repository_id, 'repo-uuid-ok');

    // Assert Celery task was dispatched with correct payload
    assert.strictEqual(celeryDelayCalled, true);
    assert.strictEqual(celeryDelayPayload.reviewId, result.reviewId);
    assert.strictEqual(celeryDelayPayload.userId, 'user-uuid-ok');
    assert.strictEqual(celeryDelayPayload.userEmail, null);
    assert.strictEqual(celeryDelayPayload.pullNumber, 10);
    assert.strictEqual(celeryDelayPayload.delivery_id, 'delivery-id-ok');
  });

  await t.test('queuing failure updates review row to failed', async () => {
    redis.get = async () => null;
    redis.set = async () => 'OK';

    let supabaseUpdateCalled = false;
    let supabaseUpdatePayload = null;

    supabaseAdmin.from = (table) => {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (table === 'repositories') {
                return {
                  data: { id: 'repo-uuid-err', user_id: 'user-uuid-err', is_active: true, full_name: 'owner/repo', owner: 'owner', name: 'repo' },
                  error: null
                };
              }
              if (table === 'github_accounts') {
                return { data: { id: 'acc-uuid' }, error: null };
              }
              return { data: null, error: null };
            }
          })
        }),
        insert: () => ({ error: null }),
        update: (payload) => {
          supabaseUpdateCalled = true;
          supabaseUpdatePayload = payload;
          return {
            eq: async () => ({ error: null })
          };
        }
      };
    };

    // Force queueing failure
    analyzePrTask.delay = () => {
      throw new Error('Redis broker connection lost');
    };

    const payload = {
      action: 'synchronize',
      repository: { id: 12345, full_name: 'owner/repo', name: 'repo', owner: { login: 'owner' } },
      pull_request: { id: 98765, number: 10, head: { sha: 'abcdef' }, base: { sha: '123456' }, html_url: 'https://github.com/owner/repo/pull/10' },
      sender: { login: 'someuser' }
    };

    const result = await handlePullRequestEvent(payload, 'delivery-id-err', 'pull_request');
    
    assert.strictEqual(result.handled, false);
    assert.strictEqual(result.reason, 'queue_failure');
    assert.strictEqual(supabaseUpdateCalled, true);
    assert.strictEqual(supabaseUpdatePayload.status, 'failed');
    assert.ok(supabaseUpdatePayload.error.includes('Redis broker connection lost'));
  });
});

import test from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import { mock } from 'node:test';

// Set up env variables before imports
process.env.GITHUB_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.REVIEW_AGENT_URL = 'http://localhost:5050';
process.env.SERVICE_API_KEY = 'test-api-key';
process.env.SUPABASE_URL = 'https://mock.supabase.co';
process.env.SUPABASE_ANON_KEY = 'mock-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';

const { handleWebhook } = await import('../src/github/controllers/githubWebhookController.js');
const { supabaseAdmin } = await import('../src/config/supabase.js');

// Setup Supabase Mock query builder
const mockQueryBuilder = {
  select: () => mockQueryBuilder,
  eq: () => mockQueryBuilder,
  maybeSingle: async () => {
    return {
      data: {
        id: 'test-repo-uuid',
        user_id: 'test-user-uuid',
        profiles: { email: 'owner@example.com' }
      },
      error: null
    };
  }
};

mock.method(supabaseAdmin, 'from', () => mockQueryBuilder);

// Helper to generate headers and request body
function makeMockRequest(payload, eventType = 'pull_request') {
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = crypto
    .createHmac('sha256', 'test-webhook-secret')
    .update(rawBody)
    .digest('hex');

  return {
    rawBody,
    headers: {
      'x-github-event': eventType,
      'x-hub-signature-256': `sha256=${signature}`
    }
  };
}

function makeMockResponse() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
  return res;
}

test('Webhook successfully triggers review-agent for PR opened', async (t) => {
  const payload = {
    action: 'opened',
    repository: {
      id: 123456,
      full_name: 'test-owner/test-repo',
      name: 'test-repo',
      owner: { login: 'test-owner' },
      html_url: 'https://github.com/test-owner/test-repo'
    },
    pull_request: {
      number: 42,
      title: 'Fix a major bug',
      state: 'open',
      html_url: 'https://github.com/test-owner/test-repo/pull/42',
      head: { sha: 'abcdef' },
      base: { ref: 'main' },
      user: { login: 'coder' }
    }
  };

  const req = makeMockRequest(payload);
  const res = makeMockResponse();

  // Mock global fetch for duplicate check (GET) and trigger check (POST)
  const fetchMock = mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.includes('/reviews?')) {
      assert.strictEqual(options.method, 'GET');
      assert.ok(options.headers['X-User-Id'] === 'webhook-system');
      assert.ok(options.headers['X-User-Email'] === 'owner@example.com');
      return {
        ok: true,
        status: 200,
        json: async () => [] // return empty list to simulate no duplicate
      };
    }

    if (url.includes('/reviews') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      assert.strictEqual(body.repo_url, 'https://github.com/test-owner/test-repo');
      assert.strictEqual(body.pr_number, 42);
      return {
        ok: true,
        status: 202,
        json: async () => ({ review_id: 'test-review-uuid', status: 'queued' })
      };
    }

    return { ok: false, status: 404 };
  });

  await handleWebhook(req, res, () => {});

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.handled, true);

  fetchMock.mock.restore();
});

test('Webhook duplicate check prevents duplicate triggers', async (t) => {
  const payload = {
    action: 'synchronize',
    repository: {
      id: 123456,
      full_name: 'test-owner/test-repo',
      name: 'test-repo',
      owner: { login: 'test-owner' },
      html_url: 'https://github.com/test-owner/test-repo'
    },
    pull_request: {
      number: 42,
      title: 'Fix a major bug',
      state: 'open',
      html_url: 'https://github.com/test-owner/test-repo/pull/42',
      head: { sha: 'abcdef' },
      base: { ref: 'main' },
      user: { login: 'coder' }
    }
  };

  const req = makeMockRequest(payload);
  const res = makeMockResponse();

  let postCalled = false;

  const fetchMock = mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.includes('/reviews?')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            review_id: 'existing-id',
            repo_url: 'https://github.com/test-owner/test-repo',
            pr_number: 42,
            status: 'running'
          }
        ]
      };
    }

    if (url.includes('/reviews') && options.method === 'POST') {
      postCalled = true;
      return {
        ok: true,
        status: 202,
        json: async () => ({})
      };
    }

    return { ok: false, status: 404 };
  });

  await handleWebhook(req, res, () => {});

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(postCalled, false, 'POST /reviews should not be called when a running duplicate is found');

  fetchMock.mock.restore();
});

test('Webhook returns 200 OK even if review-agent is down or throws error', async (t) => {
  const payload = {
    action: 'opened',
    repository: {
      id: 123456,
      full_name: 'test-owner/test-repo',
      name: 'test-repo',
      owner: { login: 'test-owner' },
      html_url: 'https://github.com/test-owner/test-repo'
    },
    pull_request: {
      number: 42,
      title: 'Fix a major bug',
      state: 'open',
      html_url: 'https://github.com/test-owner/test-repo/pull/42',
      head: { sha: 'abcdef' },
      base: { ref: 'main' },
      user: { login: 'coder' }
    }
  };

  const req = makeMockRequest(payload);
  const res = makeMockResponse();

  // Mock fetch to simulate connection failure (refused)
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    throw new Error('fetch failed (Connection refused)');
  });

  await handleWebhook(req, res, () => {});

  // A webhook delivery error should be handled, logged, and return 200 OK to GitHub
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.handled, true);

  fetchMock.mock.restore();
});

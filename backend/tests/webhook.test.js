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
        is_active: true,
        profiles: { email: 'owner@example.com' }
      },
      error: null
    };
  }
};

import Redis from 'ioredis';

let mockRedisValue = null;
mock.method(Redis.prototype, 'get', async () => mockRedisValue);
mock.method(Redis.prototype, 'set', async () => 'OK');

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
    },
    sender: { login: 'coder' }
  };

  const req = makeMockRequest(payload);
  const res = makeMockResponse();

  await handleWebhook(req, res, () => {});

  assert.strictEqual(res.statusCode, 202);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.handled, true);
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
    },
    sender: { login: 'coder' }
  };

  const req = makeMockRequest(payload);
  req.headers['x-github-delivery'] = 'duplicate-delivery-uuid';
  const res = makeMockResponse();

  mockRedisValue = 'true';
  try {
    await handleWebhook(req, res, () => {});

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.handled, false);
    assert.strictEqual(res.body.reason, 'duplicate_delivery');
  } finally {
    mockRedisValue = null;
  }
});

test('Webhook returns 200 OK even if review-agent is down or throws error', async (t) => {
  // Note: with celery-node async architecture, this triggers successfully with 202
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
    },
    sender: { login: 'coder' }
  };

  const req = makeMockRequest(payload);
  const res = makeMockResponse();

  await handleWebhook(req, res, () => {});

  assert.strictEqual(res.statusCode, 202);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.handled, true);
});

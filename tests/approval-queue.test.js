'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canApprove, queueIssueForApproval, releaseAndPromote } = require('../src/approval-queue');
const { commandFromComment, run: runComment } = require('../src/comment-command');
const { verifyApprovalEvent, verifyCurrentIssue } = require('../src/verify-approval');
const { waitForOlderApprovals } = require('../src/workflow-queue');
const { buildStatistics } = require('../src/statistics');

function issue(number, createdAt) {
  return {
    number, state: 'open', created_at: createdAt,
    labels: [{ name: 'request-game-preset' }], user: { id: 900, login: 'contributor' }
  };
}

function mockGithub(issues) {
  const actions = [];
  const github = {
    paginate: async (_endpoint, params) => params.labels
      ? issues.filter(item => item.state === 'open' && item.labels.some(label => label.name === params.labels))
      : [],
    rest: {
      issues: {
        listForRepo() {},
        addLabels: async ({ issue_number, labels }) => {
          actions.push(['add', issue_number, ...labels]);
          const target = issues.find(item => item.number === issue_number);
          for (const name of labels) if (!target.labels.some(label => label.name === name)) target.labels.push({ name });
        },
        removeLabel: async ({ issue_number, name }) => {
          actions.push(['remove', issue_number, name]);
          const target = issues.find(item => item.number === issue_number);
          target.labels = target.labels.filter(label => label.name !== name);
        },
        get: async ({ issue_number }) => ({ data: issues.find(item => item.number === issue_number) })
      },
      repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission: 'read' } }) },
      reactions: { createForIssueComment: async () => { actions.push(['reaction']); } },
      actions: { listWorkflowRuns() {} }
    }
  };
  return { github, actions };
}

test('the shared approver list grants its recorded user IDs', () => {
  assert.equal(canApprove(42013603), true);
  assert.equal(canApprove(900), false);
  assert.equal(commandFromComment('@LizardByte-bot approve'), 'approve');
  assert.equal(commandFromComment('@LizardByte-bot approve extra'), null);
});

test('approval labels serialize requests and promote the oldest queued issue', async () => {
  const issues = [issue(1, '2026-01-01T00:00:00Z'), issue(2, '2026-01-02T00:00:00Z'),
    issue(3, '2026-01-03T00:00:00Z')];
  const { github, actions } = mockGithub(issues);
  const context = { repo: { owner: 'LizardByte', repo: 'PresetDB' }, issue: { number: 1 }, payload: {} };
  assert.deepEqual(await queueIssueForApproval({ github, context, issue: issues[0] }), ['approve-queue', 'approve-preset']);
  assert.deepEqual(await queueIssueForApproval({ github, context, issue: issues[2] }), ['approve-queue']);
  assert.deepEqual(await queueIssueForApproval({ github, context, issue: issues[1] }), ['approve-queue']);
  issues[0].state = 'closed';
  const next = await releaseAndPromote({ github, context });
  assert.equal(next.number, 2);
  assert.ok(issues[0].labels.some(label => label.name === 'approve-preset'));
  assert.ok(!issues[0].labels.some(label => label.name === 'approve-queue'));
  assert.ok(actions.some(action => action[0] === 'add' && action[1] === 2 && action[2] === 'approve-preset'));
});

test('releasing an open approval removes both labels in order before promoting the next issue', async () => {
  const current = issue(1, '2026-01-01T00:00:00Z');
  const queued = issue(2, '2026-01-02T00:00:00Z');
  current.labels.push({ name: 'approve-preset' }, { name: 'approve-queue' });
  queued.labels.push({ name: 'approve-queue' });
  const { github, actions } = mockGithub([current, queued]);
  const context = { repo: { owner: 'LizardByte', repo: 'PresetDB' }, issue: { number: 1 } };
  const removeLabel = github.rest.issues.removeLabel;
  let finishRemoval;
  github.rest.issues.removeLabel = async params => {
    if (params.name === 'approve-preset') {
      await new Promise(resolve => { finishRemoval = resolve; });
    }
    return removeLabel(params);
  };
  const releasing = releaseAndPromote({ github, context });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(actions, []);
  finishRemoval();
  assert.equal((await releasing).number, 2);
  assert.deepEqual(actions, [
    ['remove', 1, 'approve-preset'], ['remove', 1, 'approve-queue'], ['add', 2, 'approve-preset']
  ]);
});

test('label removal failures stop release without removing the next label or promoting an issue', async () => {
  const current = issue(1, '2026-01-01T00:00:00Z');
  const queued = issue(2, '2026-01-02T00:00:00Z');
  current.labels.push({ name: 'approve-preset' }, { name: 'approve-queue' });
  queued.labels.push({ name: 'approve-queue' });
  const { github, actions } = mockGithub([current, queued]);
  const failedLabels = [];
  github.rest.issues.removeLabel = async ({ name }) => {
    failedLabels.push(name);
    throw new Error('Label removal failed');
  };
  await assert.rejects(releaseAndPromote({ github,
    context: { repo: { owner: 'LizardByte', repo: 'PresetDB' }, issue: { number: 1 } } }),
  /Label removal failed/);
  assert.deepEqual(failedLabels, ['approve-preset']);
  assert.deepEqual(actions, []);
});

test('release skips absent labels and leaves another active approval in charge', async () => {
  const current = issue(1, '2026-01-01T00:00:00Z');
  const active = issue(2, '2026-01-02T00:00:00Z');
  active.labels.push({ name: 'approve-preset' });
  const { github, actions } = mockGithub([current, active]);
  assert.equal(await releaseAndPromote({ github,
    context: { repo: { owner: 'LizardByte', repo: 'PresetDB' }, issue: { number: 1 } } }), null);
  assert.deepEqual(actions, []);
});

test('bot approval commands require an approver or repository admin', async () => {
  const current = issue(5, '2026-01-01T00:00:00Z');
  const { github } = mockGithub([current]);
  const context = { repo: { owner: 'LizardByte', repo: 'PresetDB' }, payload: {
    issue: current, comment: { id: 10, body: '@LizardByte-bot approve', user: { id: 900, login: 'untrusted' } }
  } };
  assert.equal(await runComment({ github, context }), false);
  context.payload.comment.user = { id: 42013603, login: 'ReenigneArcher' };
  assert.equal(await runComment({ github, context }), true);
  assert.ok(current.labels.some(label => label.name === 'approve-preset'));
  context.payload.sender = { id: 999, login: 'LizardByte-bot' };
  await verifyApprovalEvent({ github, context });
  context.payload.sender = { id: 900, login: 'untrusted' };
  await assert.rejects(verifyApprovalEvent({ github, context }), /Only a listed approver/);
});

test('approval stops when an issue changes after it was queued', async () => {
  const current = issue(8, '2026-01-01T00:00:00Z');
  current.body = 'original command';
  current.labels.push({ name: 'approve-queue' }, { name: 'approve-preset' });
  const { github } = mockGithub([current]);
  const context = { repo: { owner: 'LizardByte', repo: 'PresetDB' }, payload: {
    issue: { ...current, body: 'original command' }
  } };
  await verifyCurrentIssue({ github, context });
  current.body = 'changed command';
  await assert.rejects(verifyCurrentIssue({ github, context }), /changed after approval/);
});

test('workflow wait exits when no older approval is running', async () => {
  const { github } = mockGithub([]);
  github.paginate = async () => [
    { id: 5, status: 'in_progress', display_title: 'approve-preset current' },
    { id: 6, status: 'in_progress', display_title: 'approve-preset newer' },
    { id: 1, status: 'completed', display_title: 'approve-preset completed' },
    { id: 2, status: 'in_progress', display_title: 'another workflow' },
    { id: 3, status: 'in_progress' }
  ];
  await assert.doesNotReject(waitForOlderApprovals({ github,
    context: { repo: { owner: 'LizardByte', repo: 'PresetDB' }, runId: 5 } }));
});

test('workflow wait polls at the configured interval until the older approval finishes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const { github } = mockGithub([]);
  const calls = [];
  github.paginate = async (endpoint, params) => {
    calls.push({ endpoint, params });
    return calls.length < 3 ? [{ id: 1, status: 'in_progress', display_title: 'approve-preset older' }] : [];
  };
  let finished = false;
  const waiting = waitForOlderApprovals({ github, intervalMs: 50, timeoutMs: 200,
    context: { repo: { owner: 'LizardByte', repo: 'PresetDB' }, runId: 5 } }).then(() => {
    finished = true;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(finished, false);
  assert.equal(calls[0].endpoint, github.rest.actions.listWorkflowRuns);
  assert.deepEqual(calls[0].params, {
    owner: 'LizardByte', repo: 'PresetDB', workflow_id: 'approve-preset.yml',
    status: 'in_progress', per_page: 100
  });
  t.mock.timers.tick(49);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  t.mock.timers.tick(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.equal(finished, false);
  t.mock.timers.tick(50);
  await waiting;
  assert.equal(calls.length, 3);
  assert.equal(finished, true);
});

test('workflow wait keeps the original timeout across polling attempts', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const { github } = mockGithub([]);
  let calls = 0;
  github.paginate = async () => {
    calls++;
    return [{ id: 1, status: 'in_progress', display_title: 'approve-preset older' }];
  };
  const timedOut = assert.rejects(waitForOlderApprovals({ github, intervalMs: 50, timeoutMs: 100,
    context: { repo: { owner: 'LizardByte', repo: 'PresetDB' }, runId: 5 } }),
  /Timed out waiting for older approval run 1/);
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(50);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  t.mock.timers.tick(50);
  await timedOut;
  assert.equal(calls, 3);
});

test('workflow wait propagates a polling failure without scheduling another attempt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const { github } = mockGithub([]);
  let calls = 0;
  github.paginate = async () => {
    calls++;
    if (calls === 2) throw new Error('Workflow lookup failed');
    return [{ id: 1, status: 'in_progress', display_title: 'approve-preset older' }];
  };
  const failed = assert.rejects(waitForOlderApprovals({ github, intervalMs: 50,
    context: { repo: { owner: 'LizardByte', repo: 'PresetDB' }, runId: 5 } }), /Workflow lookup failed/);
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(50);
  await failed;
  t.mock.timers.tick(50);
  assert.equal(calls, 2);
});

test('published statistics count approvals and escape contributor names', () => {
  const records = [{ presets: [{ history: [
    { issue: 1, action: 'add', author_id: 1, author_login: 'alice<&', approved_at: '2026-01-01T00:00:00Z' },
    { issue: 2, action: 'replace', author_id: 1, author_login: 'alice<&', approved_at: '2026-01-02T00:00:00Z' }
  ] }] }];
  const stats = buildStatistics({ games: [{}], apps: [] }, records);
  assert.equal(stats.data.game_count, 1);
  assert.equal(stats.data.preset_count, 1);
  assert.equal(stats.data.contribution_count, 2);
  assert.match(stats.contributorsSvg, /alice&lt;&amp;/);
  assert.match(stats.growthSvg, /1 presets/);
});

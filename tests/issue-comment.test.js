'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MARKER, upsertIssueComment } = require('../src/issue-comment');

function fixture(initialComments = []) {
  const comments = initialComments.map(comment => ({ ...comment }));
  const actions = [];
  const github = {
    paginate: async (_endpoint, params) => {
      assert.equal(params.issue_number, 6);
      return comments;
    },
    rest: {
      users: { getAuthenticated: async () => ({ data: { id: 42 } }) },
      issues: {
        listComments() {},
        createComment: async ({ body }) => {
          actions.push('create');
          const created = { id: 100, user: { id: 42 }, body };
          comments.push(created);
          return { data: created };
        },
        updateComment: async ({ comment_id, body }) => {
          actions.push('update');
          const comment = comments.find(item => item.id === comment_id);
          comment.body = body;
          return { data: comment };
        }
      }
    }
  };
  const context = { repo: { owner: 'LizardByte', repo: 'PresetDB' }, issue: { number: 6 } };
  return { github, context, comments, actions };
}

test('approval replaces the bot validation comment instead of creating a second one', async () => {
  const state = fixture([{ id: 1, user: { id: 99 }, body: MARKER + '\nOther user comment' }]);
  await upsertIssueComment({ ...state, body: 'Status: awaiting maintainer review\n' });
  await upsertIssueComment({ ...state, body: 'Status: approved and saved\n' });

  assert.deepEqual(state.actions, ['create', 'update']);
  assert.equal(state.comments.length, 2);
  assert.equal(state.comments[0].body, MARKER + '\nOther user comment');
  assert.match(state.comments[1].body, /Status: approved and saved/);
  assert.ok(state.comments[1].body.endsWith(MARKER));
});

test('an older bot report is reused and an unchanged result is not posted again', async () => {
  const state = fixture([{ id: 9, user: { id: 42 }, body: 'Preset request validated for GameDB game 1164.' }]);
  const body = 'Preset request validated for GameDB game 1164.\n\n- Status: approved and saved\n';
  await upsertIssueComment({ ...state, body });
  await upsertIssueComment({ ...state, body });

  assert.deepEqual(state.actions, ['update']);
  assert.equal(state.comments.length, 1);
  assert.ok(state.comments[0].body.endsWith(MARKER));
});
test('the next check after an issue edit updates the original status comment', async () => {
  const state = fixture();
  await upsertIssueComment({ ...state, body: 'Preset validation failed: Invalid command\n' });
  await upsertIssueComment({ ...state, body: 'Preset request validated for GameDB game 1164.\n' });

  assert.deepEqual(state.actions, ['create', 'update']);
  assert.equal(state.comments.length, 1);
  assert.match(state.comments[0].body, /Preset request validated/);
  assert.doesNotMatch(state.comments[0].body, /validation failed/);
});

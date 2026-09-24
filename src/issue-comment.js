'use strict';

const MARKER = '<!-- PresetDB status -->';
const LEGACY_REPORT = /^(?:Preset (?:request|replacement) validated for |Preset validation failed: |Approval stopped: )/;

async function upsertIssueComment({ github, context, body }) {
  const issue = { ...context.repo, issue_number: context.issue.number };
  const { data: actor } = await github.rest.users.getAuthenticated();
  const comments = await github.paginate(github.rest.issues.listComments, { ...issue, per_page: 100 });
  const existing = comments.findLast(comment => comment.user?.id === actor.id &&
    (comment.body?.includes(MARKER) || LEGACY_REPORT.test(comment.body || '')));
  const markedBody = body.trimEnd() + '\n\n' + MARKER;

  if (existing) {
    if (existing.body !== markedBody) {
      await github.rest.issues.updateComment({ ...context.repo, comment_id: existing.id, body: markedBody });
    }
    return existing.id;
  }

  const { data: created } = await github.rest.issues.createComment({ ...issue, body: markedBody });
  return created.id;
}

module.exports = { MARKER, upsertIssueComment };

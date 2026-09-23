'use strict';

const { canApprove, isPresetRequest, labelNames, queueIssueForApproval } = require('./approval-queue');

function commandFromComment(body) {
  const match = /^@LizardByte-bot\s+(approve|check)\s*$/i.exec(String(body || '').trim());
  return match ? match[1].toLowerCase() : null;
}

async function isAuthorized({ github, context, command }) {
  const user = context.payload.comment.user;
  if (canApprove(user.id, command)) return true;
  if (command === 'check' && user.id === context.payload.issue.user.id) return true;
  try {
    const { data } = await github.rest.repos.getCollaboratorPermissionLevel({
      ...context.repo, username: user.login
    });
    return data.permission === 'admin';
  } catch {
    return false;
  }
}

async function run({ github, context }) {
  const command = commandFromComment(context.payload.comment.body);
  if (!command || !isPresetRequest(context.payload.issue)) return false;
  if (!await isAuthorized({ github, context, command })) return false;
  if (command === 'approve') {
    await queueIssueForApproval({ github, context });
  } else {
    const issue = context.payload.issue;
    const label = labelNames(issue).has('request-game-preset') ? 'request-game-preset' : 'request-app-preset';
    await github.rest.issues.removeLabel({ ...context.repo, issue_number: issue.number, name: label });
    await new Promise(resolve => setTimeout(resolve, 1000));
    await github.rest.issues.addLabels({ ...context.repo, issue_number: issue.number, labels: [label] });
  }
  await github.rest.reactions.createForIssueComment({
    ...context.repo, comment_id: context.payload.comment.id, content: '+1'
  });
  return true;
}

module.exports = { commandFromComment, isAuthorized, run };

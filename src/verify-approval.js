'use strict';

const { APPROVE_LABEL, QUEUE_LABEL, canApprove, isPresetRequest, labelNames } = require('./approval-queue');

async function verifyApprovalEvent({ github, context }) {
  const issue = context.payload.issue;
  const labels = labelNames(issue);
  if (!isPresetRequest(issue) || !labels.has(QUEUE_LABEL) || !labels.has(APPROVE_LABEL)) {
    throw new Error('Approval requires an open queued preset request');
  }
  const sender = context.payload.sender;
  if (sender.login === 'LizardByte-bot' || canApprove(sender.id)) return;
  let permission;
  try {
    const { data } = await github.rest.repos.getCollaboratorPermissionLevel({
      ...context.repo, username: sender.login
    });
    permission = data.permission;
  } catch { /* A non-collaborator has no approval permission. */ }
  if (permission !== 'admin') throw new Error('Only a listed approver or repository admin may approve');
}

async function verifyCurrentIssue({ github, context }) {
  const { data: current } = await github.rest.issues.get({
    ...context.repo, issue_number: context.payload.issue.number
  });
  const labels = labelNames(current);
  if (!isPresetRequest(current) || !labels.has(QUEUE_LABEL) || !labels.has(APPROVE_LABEL) ||
      current.body !== context.payload.issue.body) {
    throw new Error('Issue changed after approval was queued; validate and approve it again');
  }
}

module.exports = { verifyApprovalEvent, verifyCurrentIssue };

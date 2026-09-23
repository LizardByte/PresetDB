'use strict';

const fs = require('node:fs');
const path = require('node:path');

const QUEUE_LABEL = 'approve-queue';
const APPROVE_LABEL = 'approve-preset';
const REQUEST_LABELS = new Set(['request-game-preset', 'request-app-preset']);

function labelNames(issue) {
  return new Set((issue.labels || []).map(label => typeof label === 'string' ? label : label.name));
}

function isPresetRequest(issue) {
  const labels = labelNames(issue);
  return issue.state === 'open' && !issue.pull_request &&
    [...REQUEST_LABELS].filter(label => labels.has(label)).length === 1;
}

function loadApprovers(file = path.join(__dirname, '..', 'auto_approved_users.json')) {
  const users = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(users)) throw new Error('auto_approved_users.json must contain a list');
  return users;
}

function canApprove(userId, command = 'approve', users = loadApprovers()) {
  const id = String(userId ?? '');
  return id !== '' && users.some(user => String(user.user_id) === id &&
    Array.isArray(user.commands) && (user.commands.includes('*') || user.commands.includes(command)));
}

function repoParams(context) {
  return { owner: context.repo.owner, repo: context.repo.repo };
}

async function listOpenIssuesWithLabel({ github, context, label }) {
  const issues = await github.paginate(github.rest.issues.listForRepo, {
    ...repoParams(context), state: 'open', labels: label, per_page: 100
  });
  return issues.filter(issue => !issue.pull_request);
}

async function hasActiveApproval({ github, context, issueNumber }) {
  const issues = await listOpenIssuesWithLabel({ github, context, label: APPROVE_LABEL });
  return issues.some(issue => issue.number !== Number(issueNumber));
}

async function queueIssueForApproval({ github, context, issue = context.payload.issue }) {
  if (!isPresetRequest(issue)) throw new Error('Only one open game or app preset request can be queued');
  const labels = labelNames(issue);
  if (labels.has(APPROVE_LABEL)) return [QUEUE_LABEL, APPROVE_LABEL];
  const active = await hasActiveApproval({ github, context, issueNumber: issue.number });
  const labelsToAdd = active ? [QUEUE_LABEL] : [QUEUE_LABEL, APPROVE_LABEL];
  await github.rest.issues.addLabels({
    ...repoParams(context), issue_number: issue.number, labels: labelsToAdd
  });
  return labelsToAdd;
}

async function releaseAndPromote({ github, context, issueNumber = context.issue.number }) {
  const params = { ...repoParams(context), issue_number: issueNumber };
  const { data: issue } = await github.rest.issues.get(params);
  const labels = labelNames(issue);
  const labelsToRemove = issue.state === 'closed' ? [QUEUE_LABEL] : [APPROVE_LABEL, QUEUE_LABEL];
  for (const label of labelsToRemove) {
    if (labels.has(label)) await github.rest.issues.removeLabel({ ...params, name: label });
  }
  if (await hasActiveApproval({ github, context, issueNumber })) return null;
  const queued = await listOpenIssuesWithLabel({ github, context, label: QUEUE_LABEL });
  const next = queued.filter(item => item.number !== Number(issueNumber) && isPresetRequest(item))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.number - b.number)[0];
  if (!next) return null;
  await github.rest.issues.addLabels({
    ...repoParams(context), issue_number: next.number, labels: [APPROVE_LABEL]
  });
  return next;
}

module.exports = {
  APPROVE_LABEL, QUEUE_LABEL, canApprove, hasActiveApproval, isPresetRequest,
  labelNames, listOpenIssuesWithLabel, loadApprovers, queueIssueForApproval, releaseAndPromote
};

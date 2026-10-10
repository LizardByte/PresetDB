'use strict';

async function waitForOlderApprovals({ github, context, intervalMs = 30000, timeoutMs = 3600000 }) {
  const started = Date.now();
  async function pollOlderApprovals() {
    const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
      ...context.repo, workflow_id: 'approve-preset.yml', status: 'in_progress', per_page: 100
    });
    const older = runs.filter(run => run.status === 'in_progress' && run.id < context.runId &&
      String(run.display_title || '').startsWith('approve-preset '));
    if (older.length === 0) return;
    if (Date.now() - started >= timeoutMs) {
      throw new Error(`Timed out waiting for older approval run ${older[0].id}`);
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    return pollOlderApprovals();
  }
  return pollOlderApprovals();
}

module.exports = { waitForOlderApprovals };

# Approver Guide

This guide is for listed approvers and repository administrators reviewing game and app preset issues.

1. Open the oldest validated request in the [game queue](https://github.com/LizardByte/PresetDB/issues?q=is%3Aopen+label%3Arequest-game-preset) or [app queue](https://github.com/LizardByte/PresetDB/issues?q=is%3Aopen+label%3Arequest-app-preset). Check the latest validation comment after the last issue edit.
2. For games, check the IGDB URL and resolved GameDB record. For apps, inspect the official URL and optional image URL. App requests always need a separate review, including when a trusted contributor submits them.
3. Check the host OS, game launch method, store launch ID or manual command, working directory, and setup notes against the [preset guidelines](presetGuidelines.md) and [Sunshine examples](https://github.com/LizardByte/Sunshine/blob/master/docs/app_examples.md). Confirm the store ID belongs to the requested game. Automated validation checks ID syntax and never runs commands.
4. Search the published record for the same OS, method, and emulator variant. A replacement must identify an existing preset issue and explain the change.
5. Comment `@LizardByte-bot approve` to enter the approval queue. The bot adds `approve-queue` and starts `approve-preset` when the active slot is free. It revalidates against IGDB and GameDB before writing to the `database` branch.

The approval workflow comments its result. A successful approval closes the issue and requests a Pages rebuild. On failure, it removes the issue from the queue so the next request can proceed; fix the issue and queue it again. The `approve-preset` label remains on successfully closed issues for the approved count badge.

The trusted user list lives in [`auto_approved_users.json`](../auto_approved_users.json). Add or remove an approver by changing that file in a reviewed pull request. A listed game submitter is queued automatically after successful validation. Repository administrators can also approve by comment.

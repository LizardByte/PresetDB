# Developer Setup

The application, automation helpers, and site builder use Node.js 24. Install dependencies and run local checks with:

```shell
npm ci --ignore-scripts
npm test
npm run lint
```

List pending database migrations without changing records with:

```shell
node src/migrate-database.js --database database --pending
```

The `Migrate Database` workflow runs on pushes to `master`. It creates a backup branch from the current database commit before changing records, then writes applied migration IDs and backup details to `database/migrations.json` on the active `database` branch. Re-runs skip IDs already in that file.

Build the static site from the local database layout with:

```shell
node src/build-site.js --database database --output site-build
```

The site builder writes `index.json`, `stats.json`, two SVG contribution charts, and game and app records. It uses the `gh-pages-template` directory as the Jekyll source. The Pages workflow packages that output for the shared LizardByte Jekyll workflow.

Read the Docs pull request previews use `.readthedocs.yaml` and the shared `readthedocs_build.sh` script. Connect the repository to Read the Docs, enable pull request builds, and set these project environment variables:

```text
GITHUB_WORKFLOW=call-jekyll-build / Build Jekyll
SITE_ARTIFACT=update.zip
EXTRACT_ARCHIVE=build.zip
```

For pull requests, Build Pages applies pending migrations in the runner checkout of the database branch before assembling the preview. It does not commit or push that checkout. The Migrate Database workflow creates the real backup branch and updates the database only after a push to master.

The `Build Pages` workflow publishes a check run named `call-jekyll-build / Build Jekyll`, uploads an `update` artifact containing `build.zip`, and the shared script extracts that nested archive before building with the organization theme. Hosted preview and Pages deployment require the repository, credentials, and branch settings described in the README.

# Developer Setup

The application, automation helpers, and site builder use Node.js 24. Install dependencies and run local checks with:

```shell
npm ci --ignore-scripts
npm test
npm run lint
```

Build the static site from the local database layout with:

```shell
node src/build-site.js --database database --output site-build
```

The site builder writes `index.json`, `stats.json`, two SVG contribution charts, and game and app records. It uses the `gh-pages-template` directory as the Jekyll source. The Pages workflow packages that output for the shared LizardByte Jekyll workflow.

Read the Docs pull request previews use `.readthedocs.yaml` and the shared `readthedocs_build.sh` script. Connect the repository to Read the Docs, enable pull request builds, and ensure the `Build Pages` workflow can upload its `site-source` artifact for the PR commit. The shared script downloads `build.zip` from that artifact and builds the preview with the organization theme. Hosted preview and Pages deployment require the repository, credentials, and branch settings described in the README.

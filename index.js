const Heroku = require('heroku-client');
const core = require('@actions/core');
const github = require('@actions/github');

const VALID_EVENT = 'pull_request';

async function run() {
  try {
    const githubToken = core.getInput('github_token', { required: true });
    const prLabel = core.getInput('github_label', {
      required: false,
      default: 'Review App',
    });
    const herokuApiToken = core.getInput('heroku_api_token', {
      required: true,
    });
    const herokuPipelineId = core.getInput('heroku_pipeline_id', {
      required: true,
    });

    const octokit = new github.getOctokit(githubToken);
    const heroku = new Heroku({ token: herokuApiToken });

    const {
      action,
      eventName,
      payload: {
        pull_request: {
          head: {
            ref: branch,
            sha: version,
            repo: {
              id: repoId,
              fork: forkRepo,
              html_url: repoHtmlUrl,
            },
          },
          number: prNumber,
          // updated_at: prUpdatedAtRaw,
        },
      },
      issue: {
        number: issueNumber,
      },
      repo,
    } = github.context;

    const {
      owner: repoOwner,
    } = repo;

    if (eventName !== VALID_EVENT) {
      throw new Error(`Unexpected github event trigger: ${eventName}`);
    }

    // const prUpdatedAt = DateTime.fromISO(prUpdatedAtRaw);
    const sourceUrl = `${repoHtmlUrl}/tarball/${version}`;
    const forkRepoId = forkRepo ? repoId : undefined;

    const getAppDetails = async id => heroku.get(`/apps/${id}`);

    const outputAppDetails = (app) => {
      const {
        id: appId,
        web_url: webUrl,
      } = app;
      core.setOutput('app_id  ', appId);
      core.setOutput('app_web_url', webUrl);
    };

    const findReviewApp = async () => {
      core.startGroup('Find existing review app');
      core.debug('Listing review apps...');
      const reviewApps = await heroku.get(`/pipelines/${herokuPipelineId}/review-apps`);
      core.info(`Listed ${reviewApps.length} review apps OK.`);

      core.debug(`Finding review app for PR #${prNumber}...`);
      const app = reviewApps.find(app => app.pr_number === prNumber);
      if (app) {
        const { status } = app;
        if ('errored' === status) {
          core.notice(`Found review app for PR #${prNumber} OK, but status is "${status}"`);
          return null;
        }
        core.info(`Found review app for PR #${prNumber} OK.`);
      } else {
        core.info(`No review app found for PR #${prNumber}`);
      }
      core.endGroup();
      return app;
    };

    // const waitReviewAppUpdated = async (reviewApp) => {
    const waitReviewAppUpdated = async () => {
      core.startGroup('Ensure PR is up to date');

      const waitSeconds = secs => new Promise((resolve) => {
        setTimeout(() => resolve, secs * 1000);
      });

      const checkStatus = async (app) => {
        core.debug(`Checking build status for app: ${JSON.stringify(app)}`);
        if ('pending' === app.status || 'creating' === app.status) {
          return false;
        }
        if ('deleting' === app.status) {
          throw new Error(`Unexpected app status: "${app.status}" - ${app.message} (error status: ${app.error_status})`);
        }
        if (!app.app) {
          throw new Error(`Unexpected app status: "${app.status}"`);
        }
        const {
          app: {
            id: appId,
          },
          status,
          error_status: errorStatus,
        } = app;

        core.debug(`Fetching latest builds for app ${appId}...`);
        const latestBuilds = await heroku.get(`/apps/${appId}/builds`);
        core.debug(`Fetched latest builds for pipeline ${appId} OK: ${latestBuilds.length} builds found.`);

        core.debug(`Finding build matching version ${version}...`);
        const build = await latestBuilds.find(build => version === build.source_blob.version);
        if (!build) {
          core.error(`Could not find build matching version ${version}.`);
          core.setFailed(`No existing build for app ID ${appId} matches version ${version}`);
          throw new Error(`Unexpected build status: "${status}" yet no matching build found`);
        }
        core.info(`Found build matching version ${version} OK: ${JSON.stringify(build)}`);

        switch (build.status) {
          case 'succeeded':
            return true;
          case 'pending':
            return false;
          default:
            throw new Error(`Unexpected build status: "${status}": ${errorStatus || 'no error provided'}`);
        }
      };

      let reviewApp;
      let isFinished;
      do {
        reviewApp = await findReviewApp();
        isFinished = await checkStatus(reviewApp);
        await waitSeconds(5);
      } while (!isFinished);
      core.endGroup();
      return getAppDetails(reviewApp.app.id);
    };

    const createReviewApp = async () => {
      try {
        core.startGroup('Create review app');

        const archiveBody = {
          owner: repoOwner,
          repo: repo.repo,
          ref: version,
        };
        core.debug(`Fetching archive: ${JSON.stringify(archiveBody)}`);
        const { url: archiveUrl } = await octokit.rest.repos.downloadTarballArchive(archiveBody);
        core.info(`Fetched archive OK: ${JSON.stringify(archiveUrl)}`);

        const body = {
          branch,
          pipeline: herokuPipelineId,
          source_blob: {
            url: archiveUrl,
            version,
          },
          fork_repo_id: forkRepoId,
          pr_number: prNumber,
          environment: {
            GIT_REPO_URL: repoHtmlUrl,
          },
        };
        core.debug(`Creating heroku review app: ${JSON.stringify(body)}`);
        const app = await heroku.post('/review-apps', { body });
        core.info('Created review app OK:', app);
        core.endGroup();

        return app;
      } catch (err) {
        // 409 indicates duplicate; anything else is unexpected
        if (err.statusCode !== 409) {
          throw err;
        }
        // possibly build kicked off after this PR action began running
        core.warning('Review app now seems to exist after previously not...');
        core.endGroup();

        // just some sanity checking
        const app = await findReviewApp();
        if (!app) {
          throw new Error('Previously got status 409 but no app found');
        }
        return app;
      }
    };

    core.debug(`Deploy info: ${JSON.stringify({
      branch,
      version,
      repoId,
      forkRepo,
      forkRepoId,
      repoHtmlUrl,
      prNumber,
      issueNumber,
      repoOwner,
      sourceUrl,
    })}`);

    if (forkRepo) {
      core.notice('No secrets are available for PRs in forked repos.');
      return;
    }

    if ('labeled' === action) {
      core.startGroup('PR labelled');
      core.debug('Checking PR label...');
      const {
        payload: {
          label: {
            name: newLabelAddedName,
          },
        },
      } = github.context;
      if (newLabelAddedName === prLabel) {
        core.info(`Checked PR label: "${newLabelAddedName}", so need to create review app...`);
        await createReviewApp();
        const app = await waitReviewAppUpdated();
        outputAppDetails(app);
      } else {
        core.info('Checked PR label OK: "${newLabelAddedName}", no action required.');
      }
      core.endGroup();
      return;
    }

    // Only people that can close PRs are maintainers or the author
    // hence can safely delete review app without being collaborator
    if ('closed' === action) {
      core.debug('PR closed, deleting review app...');
      const app = await findReviewApp();
      if (app) {
        await heroku.delete(`/review-apps/${app.id}`);
        core.info('PR closed, deleted review app OK');
        core.endGroup();
      } else {
        core.error(`Could not find review app for PR #${prNumber}`);
        core.setFailed(`Action "closed", yet no existing review app for PR #${prNumber}`);
      }
      return;
    }

    // TODO: ensure we have permission
    // const perms = await tools.github.repos.getCollaboratorPermissionLevel({
    //   ...tools.context.repo,
    //   username: tools.context.actor,
    // });

    const app = await findReviewApp();
    if (!app) {
      await createReviewApp();
    }
    await waitReviewAppUpdated();
    outputAppDetails(app);

    if (prLabel) {
      core.startGroup('Label PR');
      core.debug(`Adding label "${prLabel}" to PR...`);
      await octokit.rest.issues.addLabels({
        ...repo,
        labels: [prLabel],
        issue_number: prNumber,
      });
      core.info(`Added label "${prLabel}" to PR... OK`);
      core.endGroup();
    } else {
      core.debug('No label specified; will not label PR');
    }
  } catch (err) {
    core.error(err);
    core.setFailed(err.message);
  }
}

run();

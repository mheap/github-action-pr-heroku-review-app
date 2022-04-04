const Heroku = require('heroku-client');
const core = require('@actions/core');
const github = require('@actions/github');
const { DateTime } = require('luxon');

// const HEROKU_PIPELINE_ID = 'b3db2bf0-087c-49a5-afa8-4f6b24a3ad75';
// const HEROKU_API_TOKEN = '740222ab-5378-4850-8b50-41e094cf50d1';

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
          updated_at: prUpdatedAtRaw,
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

    const prUpdatedAt = DateTime.fromISO(prUpdatedAtRaw);
    const sourceUrl = `${repoHtmlUrl}/tarball/${version}`;
    const forkRepoId = forkRepo ? repoId : undefined;

    const waitReviewAppUpdated = async (reviewApp) => {
      core.startGroup('Ensure PR is up to date');
      const reviewAppUpdatedAt = DateTime.fromISO(reviewApp.updated_at);

      core.debug(`Comparing review app updated "${reviewAppUpdatedAt}" vs review app updated "${prUpdatedAt}"`);
      if (reviewAppUpdatedAt > prUpdatedAt) {
        core.info('Review app updated after PR; OK.');
        core.endGroup();
        core.success('Action complete');
        return;
      }
      core.info('Review app updated before PR; need to wait for review app.');

      core.debug(`Fetching latest builds for pipeline ${herokuPipelineId}...`);
      const latestBuilds = await heroku.get(`/pipelines/${herokuPipelineId}/latest-builds`);
      core.debug(`Fetched latest builds for pipeline ${herokuPipelineId} OK: ${latestBuilds.length} builds found.`);

      core.debug(`Finding build matching version ${version}...`);
      const build = await latestBuilds.filter(build => version === build.source_blog.version);
      if (!build) {
        core.error(`Could not find build matching version ${version}.`);
        core.endGroup();
        core.setFailed(`No existing build for pipeline ID ${herokuPipelineId} matches version ${version}`);
        return;
      }

      const {
        id,
        app: {
          id: appId,
        },
        status,
      } = build;
      core.info(`Found build matching version ${version} OK: ${id} (status: ${status})`, build);

      const checkStatus = async () => {
        core.debug(`Checking build ${id} for app ${appId} status...`);
        const { status } = await heroku.get(`/apps/${appId}/builds/${id}`);
        core.info(`Checked build ${id} for app ${appId} status OK: ${status}`);
        switch (status) {
          case 'succeeded':
            return true;
          case 'pending':
            return false;
          default:
            throw new Error(`Unexpected build status: "${status}"`);
        }
      };

      let isFinished;
      do {
        isFinished = await checkStatus();
      } while (!isFinished);
      core.endGroup();
      core.success('Action complete');
    };

    const findReviewApp = async () => {
      core.startGroup('Find existing review app');
      core.debug('Listing review apps...');
      const reviewApps = await heroku.get(`/pipelines/${herokuPipelineId}/review-apps`);
      core.info(`Listed ${reviewApps.length} review apps OK.`);

      core.debug(`Finding review app for PR #${prNumber}...`);
      const app = reviewApps.find(app => app.pr_number === prNumber);
      if (app) {
        core.info(`Found review app for PR #${prNumber} OK.`);
      } else {
        core.info(`No review app found for PR #${prNumber}`);
      }
      core.endGroup();
      return app;
    };

    const createReviewApp = async () => {
      try {
        core.startGroup('Create review app');
        const body = {
          branch,
          pipeline: process.env.HEROKU_PIPELINE_ID,
          source_blob: {
            url: sourceUrl,
            version,
          },
          fork_repo_id: forkRepoId,
          pr_number: prNumber,
          environment: {
            GIT_REPO_URL: repoHtmlUrl,
          },
        };
        core.debug('Creating heroku review app...', body);
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
        core.warn('Review app now seems to exist...');
        core.endGroup();

        // just some sanity checking
        const app = await findReviewApp();
        if (!app) {
          throw new Error('Previously got status 409 but no app found');
        }

        await waitReviewAppUpdated(app);
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
      core.warn('No secrets are available for PRs in forked repos.');
      core.success('Action complete');
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
      } else {
        core.info('Checked PR label OK: "${newLabelAddedName}", no action required.');
      }
      core.endGroup();
      core.success('Action complete');
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
        core.success('Action complete');
      } else {
        core.error(`Could not find review app for PR #${prNumber}`);
        core.endGroup();
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
    if (app) {
      await waitReviewAppUpdated(app);
    } else {
      await createReviewApp();
    }

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

    core.success('Action complete');
  } catch (err) {
    core.error(err);
    core.setFailed(err.message);
  }
}

run();

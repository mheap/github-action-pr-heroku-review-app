const Heroku = require('heroku-client');

async function run() {
  try {
    const herokuApiToken = 'bc141f12-6e89-485b-bad7-b088c6f6576c';
    const herokuPipelineId = 'b3db2bf0-087c-49a5-afa8-4f6b24a3ad75';
    const prNumber = 2;
    const version = '72676b2ac56d900583121a93de51cc666b1b09e3';

    const heroku = new Heroku({ token: herokuApiToken });
    // const body = {
    //   'branch': 'single-repo',
    //   'pipeline': herokuPipelineId,
    //   'source_blob': {
    //     'url': 'https://github.com/launchgood/services/tarball/72676b2ac56d900583121a93de51cc666b1b09e3',
    //     'version': version,
    //   },
    //   'pr_number': prNumber,
    //   'environment': {
    //     'GIT_REPO_URL': 'https://github.com/launchgood/services',
    //   },
    // };
    // await heroku.post('/review-apps', { body });

    const reviewApps = await heroku.get(`/pipelines/${herokuPipelineId}/review-apps`);
    console.log(`Listed ${reviewApps.length} review apps OK.`);
    reviewApps.forEach(app => console.log(app));
    console.log(`Finding review app for PR #${prNumber}...`);
    const app = reviewApps.find(app => app.pr_number === prNumber);
    if (!app) {
      throw new Error('Not found');
    }
    console.log(app);

    // console.log(`Fetching latest builds for pipeline ${herokuPipelineId}...`);
    // const latestBuilds = await heroku.get(`/pipelines/${herokuPipelineId}/latest-builds`);
    // console.log(`Fetched latest builds for pipeline ${herokuPipelineId} OK: ${latestBuilds.length} builds found.`);
    // latestBuilds.forEach(build => console.log(build));

    // console.log(`Finding build matching version ${version}...`);
    // const build = await latestBuilds.filter(build => version === build.source_blob.version);
    // console.log(build);
  } catch (err) {
    console.error(err);
  }
}

run();

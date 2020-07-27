const { Toolkit } = require("actions-toolkit");

const Heroku = require("heroku-client");
const heroku = new Heroku({ token: process.env.HEROKU_API_TOKEN });

// Run your GitHub Action!
Toolkit.run(
  async (tools) => {
    const pr = tools.context.payload.pull_request;

    // Required information
    const branch = pr.head.ref;
    const version = pr.head.sha;
    const fork = pr.head.repo.fork;
    const pr_number = pr.number;
    const source_url = `${pr.head.repo.html_url}/tarball/${branch}`;

    let fork_repo_id;
    if (fork) {
      fork_repo_id = pr.head.repo.id;
    }

    tools.log.debug("Deploy Info", {
      branch,
      version,
      fork,
      pr_number,
      source_url,
    });

    let action = tools.context.payload.action;

    // We can delete a review app without them being a collaborator
    // as the only people that can close PRs are maintainers or the author
    if (action === "closed") {
      // Fetch all PRs
      tools.log.pending("Listing review apps");
      const reviewApps = await heroku.get(
        `/pipelines/${process.env.HEROKU_PIPELINE_ID}/review-apps`
      );
      tools.log.complete("Fetched review app list");

      // Filter to the one for this PR
      const app = reviewApps.find((app) => app.pr_number == pr_number);
      if (!app) {
        tools.log.info(`Could not find review app for PR number ${pr_number}`);
        return;
      }

      // Delete the PR
      tools.log.pending("Deleting review app");
      await heroku.delete(`/review-apps/${app.id}`);
      tools.log.complete("Review app deleted");
      return;
    }

    // Do they have the required permissions?
    let requiredCollaboratorPermission = process.env.COLLABORATOR_PERMISSION;
    if (requiredCollaboratorPermission) {
      requiredCollaboratorPermission = requiredCollaboratorPermission.split(
        ","
      );
    } else {
      requiredCollaboratorPermission = ["triage", "write", "maintain", "admin"];
    }

    const reviewAppLabelName =
      process.env.REVIEW_APP_LABEL_NAME || "review-app";

    const perms = await tools.github.repos.getCollaboratorPermissionLevel({
      ...tools.context.repo,
      username: tools.context.actor,
    });

    if (!requiredCollaboratorPermission.includes(perms.data.permission)) {
      tools.exit.success("User is not a collaborator. Skipping");
    }

    tools.log.info(`User is a collaborator: ${perms.data.permission}`);

    let createReviewApp = false;

    if (["opened", "reopened", "synchronize"].indexOf(action) !== -1) {
      tools.log.info("PR opened by collaborator");
      createReviewApp = true;
      await tools.github.issues.addLabels({
        ...tools.context.repo,
        labels: ["review-app"],
        issue_number: pr_number,
      });
    } else if (action === "labeled") {
      const labelName = tools.context.payload.label.name;
      tools.log.info(`${labelName} label was added by collaborator`);

      if (labelName === reviewAppLabelName) {
        createReviewApp = true;
      } else {
        tools.log.debug(`Unexpected label, not creating app: ${labelName}`);
      }
    }

    if (createReviewApp) {
      // If it's a fork, creating the review app will fail as there are no secrets available
      if (fork) {
        tools.log.pending("Fork detected. Exiting");
        tools.log.success("Action complete");
        return;
      }

      // Otherwise we can complete it in this run
      try {
        tools.log.pending("Creating review app");
        const resp = await heroku.post("/review-apps", {
          body: {
            branch,
            pipeline: process.env.HEROKU_PIPELINE_ID,
            source_blob: {
              url: source_url,
              version,
            },
            fork_repo_id,
            pr_number,
          },
        });
        tools.log.complete("Created review app");
      } catch (e) {
        // A 409 is a conflict, which means the app already exists
        if (e.statusCode !== 409) {
          throw e;
        }
        tools.log.complete("Review app is already created");
      }
    }

    tools.log.success("Action complete");
  },
  {
    event: [
      "pull_request.opened",
      "pull_request.reopened",
      "pull_request.synchronize",
      "pull_request.labeled",
      "pull_request.closed",
    ],
    secrets: ["GITHUB_TOKEN", "HEROKU_API_TOKEN", "HEROKU_PIPELINE_ID"],
  }
);

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

    let action = tools.context.payload.action;
    if (["opened", "synchronize"].indexOf(action) !== -1) {
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
      }
    }
  },
  {
    event: [
      "pull_request.opened",
      "pull_request.synchronize",
      "pull_request.labeled",
    ],
    secrets: ["GITHUB_TOKEN", "HEROKU_API_TOKEN", "HEROKU_PIPELINE_ID"],
  }
);

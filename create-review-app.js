const { Toolkit } = require("actions-toolkit");
const fetch = require("node-fetch");

const tools = new Toolkit();

(async () => {
  // Ensure we have all of the required environment variables
  ["GITHUB_EVENT_NAME", "HEROKU_APPLICATION_ID", "HEROKU_AUTH_TOKEN"].forEach(
    name => {
      if (!process.env[name]) {
        log(`Missing required environment variable: ${name}`);
        process.exit(0);
      }
    }
  );

  // Is this an event we want to respond to?
  if (tools.context.event !== "pull_request") {
    log("Not a pull_request. Skipping");
    process.exit(0);
  }

  let requiredCollaboratorPermission = process.env.COLLABORATOR_PERMISSION;
  if (requiredCollaboratorPermission) {
    requiredCollaboratorPermission = requiredCollaboratorPermission.split(",");
  } else {
    requiredCollaboratorPermission = ["write", "admin"];
  }

  const reviewAppLabelName = process.env.REVIEW_APP_LABEL_NAME || "review-app";

  const octokit = tools.createOctokit();

  // Does the current user have write access to the repo?
  const perms = await octokit.repos.getCollaboratorPermissionLevel(
    tools.context.repo({ username: tools.context.actor })
  );

  if (!requiredCollaboratorPermission.includes(perms.data.permission)) {
    log("User is not a collaborator. Skipping");
    process.exit(0);
  }

  log(`User is a collaborator: ${perms.data.permission}`);

  let createReviewApp = false;

  // If the user has permission, add a label so that we know it already has
  // a review app
  if (tools.context.payload.action === "opened") {
    log("PR opened by collaborator");
    createReviewApp = true;
    await octokit.issues.addLabels(
      tools.context.repo({
        labels: ["review-app"],
        number: tools.context.payload.number
      })
    );

    // Or if it's an unknown user, but a collaborator adds the review app label
  } else if (tools.context.payload.action === "labeled") {
    log("Label was added by collaborator");
    log(`Looking for label '${reviewAppLabelName}'`);

    if (tools.context.payload.label.name == reviewAppLabelName) {
      log(`Expected label: ${tools.context.payload.label.name}`);
      createReviewApp = true;
    } else {
      log(
        `Unexpected label, not creating app: ${
          tools.context.payload.label.name
        }`
      );
    }
  } else {
    log(`Unexpected action, not creating app: ${tools.context.payload.action}`);
  }

  if (createReviewApp) {
    log("Creating review app");

    const body = { pull_request: { number: tools.context.payload.number } };
    let resp = await fetch(
      `https://kolkrabbi.heroku.com/apps/${
        process.env.HEROKU_APPLICATION_ID
      }/github/pull-requests`,
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
          Authorization: `Bearer ${process.env.HEROKU_AUTH_TOKEN}`,
          "Content-Type": "application/json; charset=UTF-8"
        }
      }
    );

    log("Review application created");
  }
})();

function log(msg) {
  console.log("[heroku-review-app] " + msg);
}

# Github PR to create Heroku Review App 

Heroku review apps can be enabled or disabled on a per-project basis, but for
[Nexmo Developer](https://github.com/nexmo/nexmo-developer) we wanted to enable 
automatic review apps only for collaborators.

There's no way to accomplish this with just Heroku, but the HTTP request to 
trigger a review app is available in the Heroku Dashboard.

This Github Action checks if the PR being raised is from someone with `admin` or
`write` access to the repo. If so, it automatically creates a review application.
If it's from a non-collaborator a review app will not be created, but a
collaborator can trigger a review app by adding the `review-app` label to the PR.

## Usage

Find your Heroku application ID and authentication token by triggering a review
app in the Heroku dashboard (the network inspector in your browser can help).
Create `HEROKU_APPLICATION_ID` and `HEROKU_AUTH_TOKEN` as secrets in your
workflow containing these values.

Add the following to `.github/main.workflow`:

```
workflow "PR Edited" {
  resolves = ["Create Review App"]
  on = "pull_request"
}

action "Create Review App" {
  uses = "docker://mheap/github-action-pr-heroku-review-app"
  secrets = [
    "GITHUB_TOKEN",
    "HEROKU_APPLICATION_ID",
    "HEROKU_AUTH_TOKEN",
  ]
}
```

## Configuration

* `HEROKU_APPLICATION_ID` - the application to create review apps for
* `HEROKU_AUTH_TOKEN` - your Heroku authentication token. Just the part after `Bearer`
* `COLLABORATOR_PERMISSION` - allowed permission levels, comma separated (default `admin,write`)
* `REVIEW_APP_LABEL_NAME` - the name of the label to watch for (default `review-app`)

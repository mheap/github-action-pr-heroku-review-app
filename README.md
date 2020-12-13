# Heroku Review Application

Create a Heroku review app when a PR is raised by someone with write or admin access

## Usage

```yaml
name: Heroku Review Application
on:
  pull_request:
    types: [opened, reopened, synchronize, labeled, closed]
  pull_request_target:
    types: [opened, reopened, synchronize, labeled, closed]

jobs:
  heroku-review-application:
    name: Heroku Review Application
    runs-on: ubuntu-latest
    steps:
      - name: Heroku Review Application
        uses: mheap/github-action-pr-heroku-review-app@master
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Available Configuration

### Environment Variables

| Name               | Description                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| GITHUB_TOKEN       | The GitHub auth token, used to authenticate API requests. Use the value provided in `${{ secrets.GITHUB_TOKEN }}` |
| HEROKU_API_TOKEN   | The API key used to communicate with Heroku                                                                       |
| HEROKU_PIPELINE_ID | The Heroku pipeline to trigger a review app in                                                                    |

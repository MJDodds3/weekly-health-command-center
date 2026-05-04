# Databricks on-demand refresh

The Weekly Health Command Center can refresh from Databricks at runtime through the backend endpoint:

```http
POST /api/health/refresh
```

Set these environment variables on the server:

```bash
DATABRICKS_HOST=https://dbc-08739ace-333a.cloud.databricks.com
DATABRICKS_TOKEN=<store as a secret, never commit>
DATABRICKS_WAREHOUSE_ID=33ede2bc605f8cd7
```

The refresh endpoint:

- Submits the past-7-days vs prior-7-days query to the Databricks SQL Statement Execution API.
- Uses `workspace.default.dailytracker_joined` and the dashboard’s source-preference logic.
- Polls until the SQL statement succeeds.
- Transforms the result into the dashboard JSON schema.
- Returns the updated report to the frontend Refresh button.

If the env vars are missing, Refresh safely falls back to the latest exported Databricks snapshot and shows a status message.

## Netlify deployment

This project includes `netlify.toml` and Netlify Functions so it can run on Netlify:

- Frontend publish directory: `dist/public`
- Build command: `npm run build`
- Functions directory: `netlify/functions`
- API redirects:
  - `/api/health/overview` → `health-overview`
  - `/api/health/refresh` → `health-refresh`
  - `/api/health/databricks/status` → `databricks-status`

In Netlify, add these under **Site configuration → Environment variables**:

```bash
DATABRICKS_HOST=https://dbc-08739ace-333a.cloud.databricks.com
DATABRICKS_TOKEN=<your Databricks PAT or service principal token>
DATABRICKS_WAREHOUSE_ID=33ede2bc605f8cd7
```

Then redeploy the site. The Refresh button will call the Netlify Function and update the dashboard from Databricks on demand.

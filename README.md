# Weekly Health Command Center

React + Express/Netlify Functions dashboard for weekly biohacking metrics.

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The static frontend builds to:

```text
dist/public
```

## Netlify build settings

Use **Import from Git** in Netlify.

- Build command: `npm run build`
- Publish directory: `dist/public`
- Functions directory: `netlify/functions`

`netlify.toml` already contains these settings and API redirects.

## Databricks environment variables

Add these in Netlify under **Site configuration → Environment variables**:

```bash
DATABRICKS_HOST=https://dbc-08739ace-333a.cloud.databricks.com
DATABRICKS_TOKEN=<set in Netlify only>
DATABRICKS_WAREHOUSE_ID=33ede2bc605f8cd7
```

Do not commit tokens or passwords to GitHub.

## Refresh

The Refresh button calls:

```http
POST /api/health/refresh
```

On Netlify, this is redirected to:

```text
/.netlify/functions/health-refresh
```

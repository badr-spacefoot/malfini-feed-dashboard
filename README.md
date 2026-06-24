# Malfini Feed Dashboard

Local dashboard for the Malfini B2B API feed, built in the same operational spirit as the Geggamoja feed dashboard: product visibility, stock monitoring, price checks, import history, and data-quality warnings.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in `MALFINI_USERNAME` and `MALFINI_PASSWORD`.
3. Run:

```powershell
.\start-dashboard.ps1
```

Then open `http://localhost:5177`.

If Node.js is already available on your PATH, `npm start` works too.

## API Sources

- `/api/v4/product`
- `/api/v4/product/availabilities`
- `/api/v4/product/prices`
- `/api/v4/product/recommended-prices`

The importer stores a local snapshot in `data/feed-cache.json`.

## GitHub Pages Automation

The public dashboard is deployed from the `gh-pages` branch and reads the static snapshot at `public/data/feed-cache.json`.

Automation is handled by `.github/workflows/update-feed.yml`:

- runs manually from GitHub Actions with **Run workflow**
- runs automatically every 6 hours
- imports the latest Malfini API feed
- publishes the refreshed static dashboard to GitHub Pages

Required repository secrets:

- `MALFINI_USERNAME`
- `MALFINI_PASSWORD`

GitHub Pages is read-only, so the **Import latest API** button is disabled online. Use the GitHub Action or the local dashboard to refresh data.

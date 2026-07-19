# Urban Service Inequality — Colombo District (Web GIS)

## Folder structure required
```
UrbanServiceWebMap/
├── index.html
├── style.css
├── script.js
└── data/
    ├── Accessibility Index.geojson   (polygons: GN_NAME, POPULATION, accessibility_index, priority_index)
    ├── Hospitals.geojson
    ├── Schools.geojson
    ├── Banks.geojson
    ├── Parks.geojson
    └── Bus Stops.geojson
```

Place your own GeoJSON files in `data/` using exactly these names (or edit the
`DATA_FILES` object at the top of `script.js` to match your own file names).

## Run it
Open the folder in VS Code and click **Go Live** (Live Server extension).
No build step, no npm install — everything loads from CDN.

## Notes
- Accessibility Index classes (5) and Priority Index classes (3) are computed
  automatically at load time using quantile breaks over your data — no manual
  thresholds to maintain.
- If a service layer file is missing, the app logs a warning and continues
  loading the rest (it won't crash the whole map).
- Field names (`GN_NAME`, `POPULATION`, `accessibility_index`, `priority_index`)
  are configurable in the `FIELD` object in `script.js`.

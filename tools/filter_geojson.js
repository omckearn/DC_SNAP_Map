#!/usr/bin/env node
// Filter a GeoJSON FeatureCollection by removing features with a given Store_Type
// Usage: node tools/filter_geojson.js input.geojson --exclude-type "Restaurant Meals Program" [--out output.geojson]

const fs = require('fs');

function die(msg) { console.error(msg); process.exit(1); }

function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    die('Usage: node tools/filter_geojson.js <input.geojson> --exclude-type "Restaurant Meals Program" [--out <output.geojson>]');
  }
  const input = args[0];
  const typeIdx = args.indexOf('--exclude-type');
  if (typeIdx === -1 || !args[typeIdx+1]) die('Missing --exclude-type value');
  const exclude = args[typeIdx+1];
  const outIdx = args.indexOf('--out');
  const out = outIdx !== -1 ? args[outIdx+1] : input;

  let gj;
  try {
    gj = JSON.parse(fs.readFileSync(input, 'utf8'));
  } catch (e) {
    die('Failed to read/parse input: ' + e.message);
  }
  if (!gj || gj.type !== 'FeatureCollection' || !Array.isArray(gj.features)) {
    die('Input is not a FeatureCollection');
  }

  const before = gj.features.length;
  gj.features = gj.features.filter(f => {
    const t = f && f.properties ? f.properties.Store_Type : undefined;
    return t !== exclude;
  });
  const after = gj.features.length;

  fs.writeFileSync(out, JSON.stringify(gj));
  console.log(`Filtered features: ${before - after} removed, ${after} kept. Wrote ${out}`);
}

if (require.main === module) main();


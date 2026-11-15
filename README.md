# Berlin Unterwegs

A family practice game for finding our way around Berlin: real streets, real U-Bahn and S-Bahn lines, late-November weather and Christmas markets.

Play: https://katbez84.github.io/berlin-unterwegs/

Open it once with internet, then add it to the home screen. After that it works offline.

## Build

    python -I tools/build_map.py     # raw OpenStreetMap downloads -> data/map.json
    python -I tools/make_icons.py    # app icons -> docs/
    python -I tools/assemble.py      # src/ + data/map.json -> docs/index.html (the site) and dist/index.html

Map data © OpenStreetMap contributors, ODbL.

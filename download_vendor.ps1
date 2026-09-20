New-Item -Path "web/vendor" -ItemType Directory -Force
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/chart.js/dist/chart.umd.min.js" -OutFile "web/vendor/chart.min.js"
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/marked/marked.min.js" -OutFile "web/vendor/marked.min.js"
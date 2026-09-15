#!/bin/bash

mkdir -p web/vendor
curl -fsSL "https://cdn.jsdelivr.net/npm/chart.js/dist/chart.umd.min.js" -o "web/vendor/chart.min.js"
curl -fsSL "https://cdn.jsdelivr.net/npm/marked/marked.min.js" -o "web/vendor/marked.min.js"
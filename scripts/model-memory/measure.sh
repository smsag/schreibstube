#!/bin/zsh
# Measure the embedding model's memory in a fresh WKWebView process — the web
# engine of Obsidian on iOS — on a Mac. Usage, from the repository root:
#   scripts/model-memory/measure.sh [latin|full|en] [batch] [rounds]
# Prints the web process's footprint at the start, once the model is loaded,
# and at the peak. iOS ends Obsidian at about 2 GB. See CONTRIBUTING.md.
set -e
here=${0:a:h}
model=${1:-latin} batch=${2:-16} rounds=${3:-6}
node "$here/build.mjs"
[[ "$here/out/host" -nt "$here/host.swift" ]] || swiftc -O "$here/host.swift" -o "$here/out/host"
node "$here/serve.mjs" & server=$!
trap 'kill $server 2>/dev/null' EXIT
: > "$here/out/steps.log"; : > "$here/out/memory.log"
before=($(pgrep -f com.apple.WebKit.WebContent || true))
"$here/out/host" "http://127.0.0.1:8765/?model=$model&batch=$batch&rounds=$rounds" "$here/out/steps.log" & host=$!
pid=""
for i in {1..40}; do
  for p in $(pgrep -f com.apple.WebKit.WebContent); do (( ${before[(Ie)$p]} )) || pid=$p; done
  [[ -n $pid ]] && break; sleep 0.25
done
while kill -0 $host 2>/dev/null; do
  footprint -p $pid 2>/dev/null | sed -nE 's/.*Footprint: ([0-9.]+) (MB|GB|KB).*/\1 \2/p' | head -1 >> "$here/out/memory.log"
  sleep 0.5
done
mb() { awk '{ print ($2 == "GB" ? $1 * 1024 : ($2 == "KB" ? $1 / 1024 : $1)) }' }
start=$(head -2 "$here/out/memory.log" | tail -1 | mb)
peak=$(mb < "$here/out/memory.log" | sort -n | tail -1)
cat "$here/out/steps.log"
printf "model=%s batch=%s: start %.0f MB, peak %.0f MB\n" "$model" "$batch" "$start" "$peak"

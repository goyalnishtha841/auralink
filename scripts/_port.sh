# Sourced by run.sh and demo.sh: use PORT if set, else the first free port from 8000 up.
# (8000 is often taken by another project's server; opening localhost:8000 would then show that app.)
if [[ -z "${PORT:-}" ]]; then
  PORT=8000
  while (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; do
    PORT=$((PORT + 1))
  done
  [[ "$PORT" != 8000 ]] && echo "Port 8000 is used by another app, so Auralink uses port $PORT."
fi
export PORT

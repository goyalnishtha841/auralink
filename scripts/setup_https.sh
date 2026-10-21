#!/usr/bin/env bash
# One-time HTTPS setup so phones allow the microphone on the passenger screen.
#
#   scripts/setup_https.sh
#
# What it does:
#   1. installs mkcert (Homebrew) if missing
#   2. `mkcert -install`: creates a private certificate authority on THIS Mac and adds it to the
#      Mac's trusted list (asks for your password). Undo any time with: mkcert -uninstall
#   3. makes a certificate for this laptop's Wi-Fi address, localhost and its .local name,
#      saved in certs/ (git-ignored)
# Phones then install the authority's public certificate from /phone-setup.html on the hub.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v mkcert >/dev/null 2>&1; then
  echo "Installing mkcert with Homebrew..."
  brew install mkcert
fi

echo
echo "Next step adds a local certificate authority to this Mac's trusted list."
echo "It is only used to make your hub's address trusted; undo it later with: mkcert -uninstall"
read -r -p "Continue? [y/N] " answer
[[ "$answer" =~ ^[Yy]$ ]] || { echo "Stopped. Nothing was changed."; exit 1; }
mkcert -install

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
NAME="$(hostname)"
mkdir -p certs
mkcert -cert-file certs/hub.pem -key-file certs/hub-key.pem ${IP:+"$IP"} localhost 127.0.0.1 "$NAME"

echo
echo "Done. Certificate made for: ${IP:-<no Wi-Fi address found>} localhost 127.0.0.1 $NAME"
echo "If you change Wi-Fi network later, run this script again (the address changes)."
echo
echo "Now:"
echo "  1. scripts/demo.sh            (starts the hub on https)"
echo "  2. On each phone open https://${IP:-<laptop IP>}:8000/phone-setup.html and follow the steps"

#!/bin/sh
# inVectus installer: macOS on Apple Silicon (preview). Windows and Linux: build from source.
#
#   curl -fsSL https://invectus.app/install.sh | sh
#
# What it does, and nothing else:
#   1. downloads inVectus-macos-arm64.tar.gz and SHA256SUMS from the latest GitHub release
#      (https://github.com/rbaltodano/inVectus/releases), or INVECTUS_VERSION if set
#   2. checks the archive against SHA256SUMS and stops if it does not match
#   3. puts inVectus.app in ~/Applications and links the `invectus` command into ~/.local/bin
# It does not use sudo, download models, change shell files or connect any AI agent.
#
# Options (environment variables):
#   INVECTUS_VERSION=0.1.0       install that release instead of the latest
#   INVECTUS_APP_DIR=<dir>       where inVectus.app goes   (default ~/Applications)
#   INVECTUS_BIN_DIR=<dir>       where `invectus` is linked (default ~/.local/bin)
set -eu

REPO="rbaltodano/inVectus"
ASSET="inVectus-macos-arm64.tar.gz"
APP_DIR="${INVECTUS_APP_DIR:-$HOME/Applications}"
BIN_DIR="${INVECTUS_BIN_DIR:-$HOME/.local/bin}"
BUNDLE_ID="app.invectus.desktop"

say() { printf '%s\n' "$*"; }
fail() { printf 'inVectus install: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "this preview installer is macOS only. Build from source: https://github.com/$REPO#build-from-source"
[ "$(uname -m)" = "arm64" ] || fail "this preview is built for Apple Silicon (arm64) only. Build from source: https://github.com/$REPO#build-from-source"
for tool in curl shasum tar; do command -v "$tool" >/dev/null 2>&1 || fail "needs $tool"; done

if [ -n "${INVECTUS_DOWNLOAD_BASE:-}" ]; then
  BASE="$INVECTUS_DOWNLOAD_BASE"                       # testing only: a local mirror
elif [ -n "${INVECTUS_VERSION:-}" ]; then
  BASE="https://github.com/$REPO/releases/download/v${INVECTUS_VERSION#v}"
else
  BASE="https://github.com/$REPO/releases/latest/download"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

say "Downloading inVectus from $BASE"
curl -fL --progress-bar -o "$TMP/$ASSET" "$BASE/$ASSET" || fail "download failed"
curl -fsSL -o "$TMP/SHA256SUMS" "$BASE/SHA256SUMS" || fail "could not download SHA256SUMS"

say "Checking the download"
grep " $ASSET\$" "$TMP/SHA256SUMS" > "$TMP/expected" || fail "SHA256SUMS has no entry for $ASSET"
(cd "$TMP" && shasum -a 256 -c expected >/dev/null) || fail "checksum mismatch: the download is not the published file; nothing was installed"

tar -xzf "$TMP/$ASSET" -C "$TMP"
NEW="$TMP/inVectus.app"
[ -x "$NEW/Contents/MacOS/invectus" ] || fail "the archive does not contain inVectus.app with the invectus command"

mkdir -p "$APP_DIR" "$BIN_DIR"
TARGET="$APP_DIR/inVectus.app"
if [ -e "$TARGET" ]; then
  # Only replace an existing inVectus.app, never some other app of the same name.
  OLD_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$TARGET/Contents/Info.plist" 2>/dev/null || true)"
  [ "$OLD_ID" = "$BUNDLE_ID" ] || fail "$TARGET exists and is not inVectus; move it and run again"
  say "Replacing $TARGET"
  rm -rf "$TARGET"
fi
mv "$NEW" "$TARGET"
ln -sf "$TARGET/Contents/MacOS/invectus" "$BIN_DIR/invectus"

VERSION_LINE="$("$BIN_DIR/invectus" --version 2>/dev/null || true)"
say ""
say "Installed ${VERSION_LINE:-inVectus}"
say "  app:     $TARGET"
say "  command: $BIN_DIR/invectus"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say ""; say "Add $BIN_DIR to your PATH to use the invectus command, e.g.:"
     say "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.zshrc" ;;
esac
say ""
say "Next:"
say "  1. Open inVectus from $APP_DIR, or run: open \"$TARGET\""
say "  2. Install an embedding model (about 134 MB) when the app asks, or run:"
say "       invectus models download bge-small-en-v1.5"
say "  3. Optional: connect an AI agent, e.g. invectus connect add claude-code"
say ""
say "This is a preview: unsigned, Apple Silicon only, tested on one Mac."

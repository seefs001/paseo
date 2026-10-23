#!/usr/bin/env bash
# Build the desktop main process and static renderer, then launch them in
# .dev/Paseo.app against ~/.paseo on port 6767.
# Stops /Applications/Paseo.app and any daemon listening on 6767 or 6768.
# Local shortcut: paseo-dev.
set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  SOURCE_DIR="$(CDPATH= cd -- "$(dirname -- "$SOURCE")" && pwd)"
  LINK_TARGET="$(readlink "$SOURCE")"
  case "$LINK_TARGET" in
    /*) SOURCE="$LINK_TARGET" ;;
    *) SOURCE="${SOURCE_DIR}/${LINK_TARGET}" ;;
  esac
done
ROOT="$(CDPATH= cd -- "$(dirname -- "$SOURCE")/.." && pwd)"
cd "$ROOT"

DEV_DIR="$ROOT/.dev"
LOG="$DEV_DIR/desktop-launch.log"
APP="$DEV_DIR/Paseo.app"
DESKTOP_DIR="$ROOT/packages/desktop"
ELECTRON_SRC="$ROOT/node_modules/electron/dist/Electron.app"
ICON="$DESKTOP_DIR/assets/icon.icns"
METRO_PID_FILE="$DEV_DIR/desktop-metro.pid"
ELECTRON_PID_FILE="$DEV_DIR/desktop-electron.pid"
LISTEN="${PASEO_LISTEN:-127.0.0.1:6767}"
HOME_DIR="${PASEO_HOME:-$HOME/.paseo}"

mkdir -p "$DEV_DIR"

ensure_path() {
  export PATH="$ROOT/node_modules/.bin:$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
  if command -v node >/dev/null 2>&1; then
    return
  fi
  local cursor_node
  cursor_node="$(ls -1d "$HOME/.local/share/cursor-agent/versions/"*/node 2>/dev/null | tail -1 || true)"
  if [ -n "$cursor_node" ] && [ -x "$cursor_node" ]; then
    export PATH="$(dirname "$cursor_node"):$PATH"
  fi
  if command -v node >/dev/null 2>&1; then
    return
  fi
  if command -v bun >/dev/null 2>&1; then
    mkdir -p "$DEV_DIR/bin"
    ln -sfn "$(command -v bun)" "$DEV_DIR/bin/node"
    export PATH="$DEV_DIR/bin:$PATH"
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "node not found. Install Node or keep bun/cursor-agent available." >&2
    exit 1
  fi
}

kill_pidfile() {
  local pidfile="$1"
  if [ ! -f "$pidfile" ]; then
    return
  fi
  local pid
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 0.4
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$pidfile"
}

quit_packaged_paseo() {
  osascript -e 'tell application "Paseo" to quit' >/dev/null 2>&1 || true
  local i=0
  while [ "$i" -lt 20 ]; do
    if ! pgrep -f '/Applications/Paseo.app/' >/dev/null 2>&1; then
      break
    fi
    sleep 0.3
    i=$((i + 1))
  done
  pkill -f '/Applications/Paseo.app/' >/dev/null 2>&1 || true
  killall Paseo >/dev/null 2>&1 || true
}

stop_previous_daemons() {
  if [ -x "$ROOT/node_modules/.bin/tsx" ]; then
    node --import tsx "$ROOT/packages/cli/src/index.ts" daemon stop --home "$HOME_DIR" --force >/dev/null 2>&1 || true
  fi
  local port
  for port in 6767 6768; do
    local pids
    pids="$(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      # shellcheck disable=SC2086
      kill $pids >/dev/null 2>&1 || true
      sleep 0.3
      # shellcheck disable=SC2086
      kill -9 $pids >/dev/null 2>&1 || true
    fi
  done
}

ensure_paseo_app() {
  if [ ! -f "$ICON" ]; then
    echo "Paseo icon missing at $ICON" >&2
    exit 1
  fi
  local ver stamp wrapper_id
  ver="$(defaults read "$ELECTRON_SRC/Contents/Info" CFBundleVersion 2>/dev/null || echo unknown)"
  wrapper_id="${ver}-keep-electron-bin"
  stamp="$DEV_DIR/Paseo.app.electron-version"
  if [ -d "$APP" ] && [ -x "$APP/Contents/MacOS/Electron" ] && [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$wrapper_id" ]; then
    return
  fi
  rm -rf "$APP"
  ditto "$ELECTRON_SRC" "$APP"
  cp "$ICON" "$APP/Contents/Resources/electron.icns"
  plutil -replace CFBundleName -string Paseo "$APP/Contents/Info.plist"
  plutil -replace CFBundleDisplayName -string Paseo "$APP/Contents/Info.plist"
  plutil -replace CFBundleIdentifier -string sh.paseo.desktop.dev "$APP/Contents/Info.plist"
  echo "$wrapper_id" >"$stamp"
}

ensure_path
: >"$LOG"

# Electron downloads its binary lazily; resolve it before building or stopping Paseo.
echo "Checking Electron runtime..."
if ! node -e 'require("electron")' >>"$LOG" 2>&1; then
  echo "Electron runtime setup failed. See $LOG" >&2
  tail -n 40 "$LOG" >&2
  exit 1
fi
if [ ! -d "$ELECTRON_SRC" ]; then
  echo "Electron.app missing at $ELECTRON_SRC" >&2
  exit 1
fi

# Build before stopping the running app, so a failed build leaves it available.
echo "Building Paseo (changes take effect on the next paseo-dev launch)..."
npm run build:app-deps >>"$LOG" 2>&1
npm run build:main --workspace=@getpaseo/desktop -- --incremental false >>"$LOG" 2>&1
(
  cd "$ROOT/packages/app"
  PASEO_WEB_PLATFORM=electron APP_VARIANT=development expo export --platform web
) >>"$LOG" 2>&1

kill_pidfile "$ELECTRON_PID_FILE"
kill_pidfile "$METRO_PID_FILE"
if [ -d "$APP" ]; then
  pkill -f "$APP/Contents/MacOS/" >/dev/null 2>&1 || true
fi
quit_packaged_paseo
stop_previous_daemons

ensure_paseo_app

(
  cd "$ROOT"
  exec env \
    PASEO_HOME="$HOME_DIR" \
    PASEO_LISTEN="$LISTEN" \
    PASEO_DAEMON_ENDPOINT="localhost:${LISTEN##*:}" \
    PASEO_CORS_ORIGINS="${PASEO_CORS_ORIGINS:-*}" \
    EXPO_DEV_URL="paseo://app/" \
    PASEO_WEB_PLATFORM=electron \
    PASEO_DISABLE_SINGLE_INSTANCE_LOCK=1 \
    APP_VARIANT=development \
    BROWSER=none \
    PATH="$PATH" \
    "$APP/Contents/MacOS/Electron" "$DESKTOP_DIR"
) >>"$LOG" 2>&1 &
echo $! >"$ELECTRON_PID_FILE"

sleep 2
if ! kill -0 "$(cat "$ELECTRON_PID_FILE")" 2>/dev/null; then
  echo "Paseo exited immediately. Last log lines:" >&2
  tail -n 40 "$LOG" >&2
  exit 1
fi

echo "Paseo launched (home $HOME_DIR, daemon $LISTEN, static renderer; no hot reload)"
echo "Logs: $LOG"

#!/bin/bash
# End-to-end check of answering from the dashboard, with real Claude Code sessions.
# Starts short background Haiku sessions (one asks a question, one needs permission to run
# mkdir), answers both through the dashboard's HTTP API, sends the first one a chat message,
# has it read a markdown file and fetches that file for the document reader, messages a busy
# interactive session, then removes the sessions. Needs the collector running.
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="$(/usr/bin/plutil -extract port raw "$ROOT/config.json" 2>/dev/null || echo 7777)"
BASE="http://127.0.0.1:$PORT"
TOKEN="$(cat "$ROOT/state/token")"
WORK="$(mktemp -d)"
# Claude Code runs mkdir in temp folders without asking, so the permission test uses a home folder.
PERMIT_DIR="$HOME/.agent-tracker-e2e-$$"
IDS=()

fail() { echo "FAIL: $*" >&2; exit 1; }
TTY_PID=""
cleanup() {
  if [ -n "$TTY_PID" ]; then pkill -P "$TTY_PID" 2>/dev/null || true; kill "$TTY_PID" 2>/dev/null || true; fi
  for id in "${IDS[@]}"; do claude rm "$id" >/dev/null 2>&1 || true; done
  rm -rf "$WORK"
  rmdir "$PERMIT_DIR" 2>/dev/null || true
}
trap cleanup EXIT

curl -fsS -o /dev/null "$BASE/api/state" || fail "collector not answering on $BASE (agent-tracker start)"

# Load the mod unless every session already does (CLAUDE_CODE_PLUGIN_DIRS).
CONFIGURED="${CLAUDE_CODE_PLUGIN_DIRS:-}:$(node -e 'try { process.stdout.write(require(process.env.HOME + "/.claude/settings.json").env.CLAUDE_CODE_PLUGIN_DIRS || "") } catch {}')"
PLUGIN_ARGS=()
case ":$CONFIGURED:" in *":$ROOT/mod:"*) ;; *) PLUGIN_ARGS=(--plugin-dir "$ROOT/mod") ;; esac

start() { # name prompt [permission mode] → short id
  (cd "$ROOT" && claude --bg "${PLUGIN_ARGS[@]}" --model haiku --permission-mode "${3:-default}" -n "$1" "$2") 2>&1 \
    | sed -n 's/.*claude logs \([0-9a-f]\{8\}\).*/\1/p' | head -1
}
session_of() { # short id → session id
  claude agents --json --all | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).find(x=>x.id===process.argv[1]);process.stdout.write(a?a.sessionId:"")})' "$1"
}
wait_ask() { # session id, kind → tool use id once the dashboard can answer it
  for _ in $(seq 1 90); do
    local id
    id="$(curl -s "$BASE/api/state" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).agents.find(x=>x.id===process.argv[1]);process.stdout.write(a?.ask?.kind===process.argv[2]?a.ask.toolUseId:"")})' "$1" "$2")"
    if [ -n "$id" ]; then echo "$id"; return 0; fi
    sleep 1
  done
  return 1
}
post() { # path json → response
  curl -s -X POST -H "content-type: application/json" -H "x-tracker-token: $TOKEN" -H "Origin: http://127.0.0.1:$PORT" -d "$2" "$BASE$1"
}
transcript_has() { # session id, text → exit 0 when the transcript contains it
  local f
  for _ in $(seq 1 60); do
    f="$(ls "$HOME"/.claude/projects/*/"$1".jsonl 2>/dev/null | head -1)"
    if [ -n "$f" ] && grep -qF -- "$2" "$f"; then return 0; fi
    sleep 1
  done
  return 1
}

echo "1/5 question answered from the dashboard"
Q=$(start e2e-ask "Use the AskUserQuestion tool to ask me exactly one question: 'Pick a colour?' with the options Red and Blue (header: Colour). After I answer, reply with only the colour I chose and stop. Do not read or change any files.")
[ -n "$Q" ] || fail "could not start the question session"
IDS+=("$Q")
QS="$(session_of "$Q")"
QID="$(wait_ask "$QS" question)" || fail "the question never became answerable on the dashboard"
R="$(post /api/actions/answer "{\"agentId\":\"$QS\",\"toolUseId\":\"$QID\",\"answers\":{\"Pick a colour?\":\"Blue\"}}")"
[ "$R" = '{"ok":true}' ] || fail "answer refused: $R"
transcript_has "$QS" '\"Pick a colour?\"=\"Blue\"' || fail "Claude never received the answer"
echo "   ok: Claude received \"Blue\""

echo "2/5 permission prompt allowed from the dashboard"
P=$(start e2e-permit "Run exactly this one Bash command and nothing else: mkdir $PERMIT_DIR   Then reply DONE. Do not read or change any other files.")
[ -n "$P" ] || fail "could not start the permission session"
IDS+=("$P")
PS="$(session_of "$P")"
PID_="$(wait_ask "$PS" permission)" || fail "the permission prompt never reached the dashboard"
R="$(post /api/actions/permit "{\"agentId\":\"$PS\",\"toolUseId\":\"$PID_\",\"decision\":\"allow\"}")"
[ "$R" = '{"ok":true}' ] || fail "decision refused: $R"
for _ in $(seq 1 60); do [ -d "$PERMIT_DIR" ] && break; sleep 1; done
[ -d "$PERMIT_DIR" ] || fail "the allowed command never ran"
echo "   ok: the command ran"

echo "3/5 chat message sent from the dashboard"
WORD="tracker-e2e-$$"
for _ in $(seq 1 60); do
  R="$(post /api/actions/message "{\"agentId\":\"$QS\",\"text\":\"Reply with only the word $WORD and stop.\"}")"
  [ "$R" = '{"ok":true}' ] && break
  sleep 1
done
[ "$R" = '{"ok":true}' ] || fail "message refused: $R"
transcript_has "$QS" "Reply with only the word $WORD" || fail "the message never reached the session"
echo "   ok: the session got the message"

echo "4/5 a markdown file the session read opens in the document reader"
DOC="$ROOT/README.md"
R="$(post /api/actions/message "{\"agentId\":\"$QS\",\"text\":\"Use the Read tool to read README.md (first 5 lines are enough), then reply with only DONE.\"}")"
[ "$R" = '{"ok":true}' ] || fail "message refused: $R"
for _ in $(seq 1 90); do
  curl -s "$BASE/api/state" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).agents.find(x=>x.id===process.argv[1]);process.exit(a?.docs?.some(d=>d.path===process.argv[2])?0:1)})' "$QS" "$DOC" && break
  sleep 1
done
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/agent/$QS/doc?path=$DOC")" = 403 ] || fail "the document was served without the token"
curl -s -H "x-tracker-token: $TOKEN" "$BASE/api/agent/$QS/doc?path=$DOC" | grep -q '# Agent Tracker' || fail "the reader could not fetch README.md"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "x-tracker-token: $TOKEN" "$BASE/api/agent/$QS/doc?path=$ROOT/package.json")" = 404 ] || fail "a file the session never opened was served"
echo "   ok: README.md is listed and readable, other files are not"

echo "5/5 a message to a busy interactive session is taken at once and queued once"
if ! command -v python3 >/dev/null; then
  echo "   skipped: needs python3 to run an interactive session"
  echo "PASS (step 5 skipped)"
  exit 0
fi
# An interactive session in a pseudo-terminal, busy writing a long answer. Variables that would
# make it think it is a child of the session running this script are dropped; the plugin path stays.
UNSET=()
for v in $(env | awk -F= '/^(CLAUDE[A-Z_]*|AI_AGENT)=/ { print $1 }'); do
  [ "$v" = CLAUDE_CODE_PLUGIN_DIRS ] || UNSET+=(-u "$v")
done
(cd "$ROOT" && exec env "${UNSET[@]}" TERM=xterm-256color python3 "$ROOT/scripts/pty-run.py" claude "${PLUGIN_ARGS[@]}" --model haiku -n "e2e-busy-$$" \
  "Write a 3000-word short story about a lighthouse keeper. Do not use any tools.") > /dev/null 2>&1 &
TTY_PID=$!
BS=""
for _ in $(seq 1 90); do
  BS="$(curl -s "$BASE/api/state" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).agents.find(x=>x.name===process.argv[1]);process.stdout.write(a?.mod?.live&&a.state==="working"?a.id:"")})' "e2e-busy-$$")"
  [ -n "$BS" ] && break
  sleep 1
done
[ -n "$BS" ] || fail "the interactive session never showed up busy with the mod listening"
BUSY_WORD="busy-e2e-$$"
R="$(post /api/actions/message "{\"agentId\":\"$BS\",\"text\":\"After that, reply with only the word $BUSY_WORD.\"}")"
[ "$R" = '{"ok":true}' ] || fail "a message to a busy session was refused: $R"
sleep 6
F="$(ls "$HOME"/.claude/projects/*/"$BS".jsonl | head -1)"
N="$(grep -c "\"operation\":\"enqueue\".*reply with only the word $BUSY_WORD" "$F" || true)"
[ "$N" = 1 ] || fail "the message was queued $N times, not once"
echo "   ok: taken at once, queued once"

for id in "${IDS[@]}"; do
  if claude logs "$id" 2>&1 | grep -q "agent-tracker.*skipped"; then fail "a mod hook was skipped in session $id"; fi
done
echo "PASS"

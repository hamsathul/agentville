#!/bin/bash
# End-to-end check of answering from the dashboard, with real Claude Code sessions.
# Starts two short background Haiku sessions (one asks a question, one needs permission to
# run mkdir), answers both through the dashboard's HTTP API, checks Claude received the
# answers, then removes the sessions. Needs the collector running.
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="$(/usr/bin/plutil -extract port raw "$ROOT/config.json" 2>/dev/null || echo 7777)"
BASE="http://127.0.0.1:$PORT"
TOKEN="$(cat "$ROOT/state/token")"
WORK="$(mktemp -d)"
IDS=()

fail() { echo "FAIL: $*" >&2; exit 1; }
cleanup() {
  for id in "${IDS[@]}"; do claude rm "$id" >/dev/null 2>&1 || true; done
  rm -rf "$WORK"
}
trap cleanup EXIT

curl -fsS -o /dev/null "$BASE/api/state" || fail "collector not answering on $BASE (agent-tracker start)"

# Load the mod unless every session already does (CLAUDE_CODE_PLUGIN_DIRS).
CONFIGURED="${CLAUDE_CODE_PLUGIN_DIRS:-}:$(node -e 'try { process.stdout.write(require(process.env.HOME + "/.claude/settings.json").env.CLAUDE_CODE_PLUGIN_DIRS || "") } catch {}')"
PLUGIN_ARGS=()
case ":$CONFIGURED:" in *":$ROOT/mod:"*) ;; *) PLUGIN_ARGS=(--plugin-dir "$ROOT/mod") ;; esac

start() { # name prompt → short id
  (cd "$ROOT" && claude --bg "${PLUGIN_ARGS[@]}" --model haiku --permission-mode default -n "$1" "$2") 2>&1 \
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

echo "1/2 question answered from the dashboard"
Q=$(start e2e-ask "Use the AskUserQuestion tool to ask me exactly one question: 'Pick a colour?' with the options Red and Blue (header: Colour). After I answer, reply with only the colour I chose and stop. Do not read or change any files.")
[ -n "$Q" ] || fail "could not start the question session"
IDS+=("$Q")
QS="$(session_of "$Q")"
QID="$(wait_ask "$QS" question)" || fail "the question never became answerable on the dashboard"
R="$(post /api/actions/answer "{\"agentId\":\"$QS\",\"toolUseId\":\"$QID\",\"answers\":{\"Pick a colour?\":\"Blue\"}}")"
[ "$R" = '{"ok":true}' ] || fail "answer refused: $R"
transcript_has "$QS" '\"Pick a colour?\"=\"Blue\"' || fail "Claude never received the answer"
echo "   ok: Claude received \"Blue\""

echo "2/2 permission prompt allowed from the dashboard"
P=$(start e2e-permit "Run exactly this one Bash command and nothing else: mkdir $WORK/allowed   Then reply DONE. Do not read or change any other files.")
[ -n "$P" ] || fail "could not start the permission session"
IDS+=("$P")
PS="$(session_of "$P")"
PID_="$(wait_ask "$PS" permission)" || fail "the permission prompt never reached the dashboard"
R="$(post /api/actions/permit "{\"agentId\":\"$PS\",\"toolUseId\":\"$PID_\",\"decision\":\"allow\"}")"
[ "$R" = '{"ok":true}' ] || fail "decision refused: $R"
for _ in $(seq 1 60); do [ -d "$WORK/allowed" ] && break; sleep 1; done
[ -d "$WORK/allowed" ] || fail "the allowed command never ran"
echo "   ok: the command ran"

for id in "${IDS[@]}"; do
  if claude logs "$id" 2>&1 | grep -q "agent-tracker.*skipped"; then fail "a mod hook was skipped in session $id"; fi
done
echo "PASS"

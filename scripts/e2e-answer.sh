#!/bin/bash
# End-to-end check of answering from the dashboard, with real Claude Code sessions.
# Starts short background Haiku sessions (one asks a question, two need permission to run
# mkdir), answers them through the dashboard's HTTP API (one with Always allow and one of Claude
# Code's own options), compacts one, sends the first one a chat message,
# has it read a markdown file and fetches that file for the document reader, sends it a
# screenshot, cancels a question (as Esc does), messages a busy interactive session and stops it
# mid-turn, then removes the sessions. Needs the collector running.
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="$(/usr/bin/plutil -extract port raw "$ROOT/config.json" 2>/dev/null || echo 7777)"
BASE="http://127.0.0.1:$PORT"
TOKEN="$(cat "$ROOT/state/token")"
WORK="$(mktemp -d)"
# Claude Code runs mkdir in temp folders without asking, so the permission test uses a home folder.
PERMIT_DIR="$HOME/.agent-tracker-e2e-$$"
ALWAYS_DIR="$HOME/.agent-tracker-e2e-always-$$"
IDS=()

fail() { echo "FAIL: $*" >&2; exit 1; }
TTY_PID=""
cleanup() {
  if [ -n "$TTY_PID" ]; then pkill -P "$TTY_PID" 2>/dev/null || true; kill "$TTY_PID" 2>/dev/null || true; fi
  for id in "${IDS[@]}"; do claude rm "$id" >/dev/null 2>&1 || true; done
  rm -rf "$WORK"
  rmdir "$PERMIT_DIR" "$ALWAYS_DIR" 2>/dev/null || true
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

echo "1/10 question answered from the dashboard"
Q=$(start e2e-ask "Use the AskUserQuestion tool to ask me exactly one question: 'Pick a colour?' with the options Red and Blue (header: Colour). After I answer, reply with only the colour I chose and stop. Do not read or change any files.")
[ -n "$Q" ] || fail "could not start the question session"
IDS+=("$Q")
QS="$(session_of "$Q")"
QID="$(wait_ask "$QS" question)" || fail "the question never became answerable on the dashboard"
R="$(post /api/actions/answer "{\"agentId\":\"$QS\",\"toolUseId\":\"$QID\",\"answers\":{\"Pick a colour?\":\"Blue\"}}")"
[ "$R" = '{"ok":true}' ] || fail "answer refused: $R"
transcript_has "$QS" '\"Pick a colour?\"=\"Blue\"' || fail "Claude never received the answer"
echo "   ok: Claude received \"Blue\""

echo "2/10 permission prompt allowed from the dashboard"
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

echo "3/10 Always allow: Claude Code's own options, one picked from the dashboard"
A=$(start e2e-always "Run exactly this one Bash command and nothing else: mkdir $ALWAYS_DIR   Then reply DONE. Do not read or change any other files.")
[ -n "$A" ] || fail "could not start the Always allow session"
IDS+=("$A")
AS="$(session_of "$A")"
AID="$(wait_ask "$AS" permission)" || fail "its permission prompt never reached the dashboard"
R="$(post /api/actions/permit "{\"agentId\":\"$AS\",\"toolUseId\":\"$AID\",\"decision\":\"always\"}")"
[ "$R" = '{"ok":true}' ] || fail "Always allow refused: $R"
wait_ask "$AS" always > /dev/null || fail "Claude Code's options never reached the dashboard"
# The option for this session only, so nothing is written to a settings file.
PICK="$(curl -s "$BASE/api/state" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=(JSON.parse(s).agents.find(x=>x.id===process.argv[1])?.ask?.options??[]).find(o=>/^Allow access .* for this session$/.test(o.label));process.stdout.write(o?`${o.option}\t${o.label}`:"")})' "$AS")"
[ -n "$PICK" ] || fail "no option for this session only among Claude Code's options"
R="$(post /api/actions/always "{\"agentId\":\"$AS\",\"toolUseId\":\"$AID\",\"option\":${PICK%%$'\t'*}}")"
[ "$R" = '{"ok":true}' ] || fail "the pick was refused: $R"
for _ in $(seq 1 60); do [ -d "$ALWAYS_DIR" ] && break; sleep 1; done
[ -d "$ALWAYS_DIR" ] || fail "the command never ran after an option was picked"
echo "   ok: the command ran, with \"${PICK#*$'\t'}\" kept"

echo "4/10 a session compacted from the dashboard"
for _ in $(seq 1 60); do
  R="$(post /api/actions/setting "{\"agentId\":\"$PS\",\"compact\":\"keep the name of the folder made\"}")"
  [ "$R" = '{"ok":true}' ] && break
  sleep 1
done
[ "$R" = '{"ok":true}' ] || fail "compact refused: $R"
transcript_has "$PS" '"isCompactSummary":true' || fail "the session never compacted"
echo "   ok: the session ran /compact"

echo "5/10 chat message sent from the dashboard"
WORD="tracker-e2e-$$"
for _ in $(seq 1 60); do
  R="$(post /api/actions/message "{\"agentId\":\"$QS\",\"text\":\"Reply with only the word $WORD and stop.\"}")"
  [ "$R" = '{"ok":true}' ] && break
  sleep 1
done
[ "$R" = '{"ok":true}' ] || fail "message refused: $R"
transcript_has "$QS" "Reply with only the word $WORD" || fail "the message never reached the session"
echo "   ok: the session got the message"

echo "6/10 the document reader and the explorer, and what they refuse"
DOC="$ROOT/README.md"
R="$(post /api/actions/message "{\"agentId\":\"$QS\",\"text\":\"Use the Read tool to read README.md (first 5 lines are enough), then reply with only DONE.\"}")"
[ "$R" = '{"ok":true}' ] || fail "message refused: $R"
for _ in $(seq 1 90); do
  curl -s "$BASE/api/state" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).agents.find(x=>x.id===process.argv[1]);process.exit(a?.docs?.some(d=>d.path===process.argv[2])?0:1)})' "$QS" "$DOC" && break
  sleep 1
done
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/agent/$QS/doc?path=$DOC")" = 403 ] || fail "the document was served without the token"
curl -s -H "x-tracker-token: $TOKEN" "$BASE/api/agent/$QS/doc?path=$DOC" | grep -q '# Agentville' || fail "the reader could not fetch README.md"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "x-tracker-token: $TOKEN" "$BASE/api/agent/$QS/doc?path=$ROOT/package.json")" = 404 ] || fail "a file the session never opened was served"
echo "   ok: README.md is listed and readable, other files are not"
L="$(curl -s -H "x-tracker-token: $TOKEN" "$BASE/api/agent/$QS/files")"
echo "$L" | grep -q '"package.json"' || fail "the explorer did not list the session's folder"
if echo "$L" | grep -q 'state/token'; then fail "the explorer listed the git-ignored token file"; fi
curl -s -H "x-tracker-token: $TOKEN" "$BASE/api/agent/$QS/file?path=$ROOT/package.json" | grep -q 'agent-tracker' || fail "the explorer could not open package.json"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "x-tracker-token: $TOKEN" "$BASE/api/agent/$QS/file?path=$ROOT/state/token")" = 403 ] || fail "the git-ignored token file was served"
echo "   ok: the explorer lists and opens the folder, and never the git-ignored token"

echo "7/10 a screenshot sent with a message is seen by the session"
# A 64x64 solid red PNG, made here so the test needs no image files.
SHOT="$(node -e '
const zlib = require("zlib");
const w = 64, h = 64, raw = Buffer.alloc((w * 3 + 1) * h);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([220, 20, 20], y * (w * 3 + 1) + 1 + x * 3);
const chunk = (type, data) => { const td = Buffer.concat([Buffer.from(type), data]); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([len, td, crc]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
process.stdout.write(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]).toString("base64"));
')"
SHOT_WORD="shot-e2e-$$"
R="$(post /api/actions/message "{\"agentId\":\"$QS\",\"text\":\"($SHOT_WORD) What single colour fills this screenshot? Reply with only the colour name.\",\"files\":[{\"name\":\"red.png\",\"data\":\"$SHOT\"}]}")"
[ "$R" = '{"ok":true}' ] || fail "a message with a screenshot was refused: $R"
SAW=""
for _ in $(seq 1 120); do
  F="$(ls "$HOME"/.claude/projects/*/"$QS".jsonl | head -1)"
  SAW="$(node -e '
const lines = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(l => { try { return JSON.parse(l); } catch { return {}; } });
const at = lines.findIndex(l => l.type === "user" && JSON.stringify(l.message?.content ?? "").includes(process.argv[2]));
if (at < 0) process.exit(0);
const after = lines.slice(at + 1);
const read = after.some(l => (l.message?.content ?? []).some?.(c => c.type === "tool_use" && c.name === "Read" && /state\/uploads\//.test(c.input?.file_path ?? "")));
const reply = after.flatMap(l => l.type === "assistant" ? (l.message?.content ?? []).filter(c => c.type === "text").map(c => c.text) : []).join(" ");
if (read && /\bred\b/i.test(reply)) process.stdout.write("yes");
' "$F" "$SHOT_WORD")"
  [ "$SAW" = yes ] && break
  sleep 1
done
[ "$SAW" = yes ] || fail "the session never opened the screenshot and named its colour"
echo "   ok: the session opened the screenshot and said it is red"

echo "8/10 ✕ Cancel on a question dismisses it and stops the turn, as Esc does"
C=$(start e2e-cancel "Use the AskUserQuestion tool to ask me exactly one question: 'Pick a size?' with the options Small and Large (header: Size). After I answer, reply with only the size. Do not read or change any files.")
[ -n "$C" ] || fail "could not start the cancel session"
IDS+=("$C")
CS="$(session_of "$C")"
CTOOL="$(wait_ask "$CS" question)" || fail "the cancel session's question never reached the dashboard"
R="$(post /api/actions/setting "{\"agentId\":\"$CS\",\"stop\":true}")"
[ "$R" = '{"ok":true}' ] || fail "the cancel was refused: $R"
transcript_has "$CS" '[Request interrupted by user]' || fail "the cancelled question left no interruption marker"
GONE=""
for _ in $(seq 1 30); do
  GONE="$(curl -s "$BASE/api/state" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).agents.find(x=>x.id===process.argv[1]);process.stdout.write(a&&!a.ask&&a.state!=="waiting"?"yes":"")})' "$CS")"
  [ "$GONE" = yes ] && break
  sleep 0.5
done
[ "$GONE" = yes ] || fail "the question still shows on the dashboard after Cancel"
echo "   ok: the question is gone and the session waits for you"

echo "9/10 a message to a busy interactive session is taken at once and queued once"
if ! command -v python3 >/dev/null; then
  echo "   skipped: needs python3 to run an interactive session"
  echo "PASS (steps 9 and 10 skipped)"
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

echo "10/10 ■ Stop ends the busy session's turn at once, as Esc does"
if [ "$(curl -s "$BASE/api/state" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).agents.find(x=>x.id===process.argv[1]);process.stdout.write(a?.state??"")})' "$BS")" != working ]; then
  echo "   skipped: the session had already finished its story"
else
  R="$(post /api/actions/setting "{\"agentId\":\"$BS\",\"stop\":true}")"
  [ "$R" = '{"ok":true}' ] || fail "the stop was refused: $R"
  transcript_has "$BS" '[Request interrupted by user]' || fail "the stopped turn left no interruption marker"
  SAID=""
  for _ in $(seq 1 20); do
    SAID="$(curl -s "$BASE/api/state" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).agents.find(x=>x.id===process.argv[1]);process.stdout.write(a?.setting?.command==="stop"?a.setting.text:"")})' "$BS")"
    [ -n "$SAID" ] && break
    sleep 0.5
  done
  [ "$SAID" = Stopped. ] || fail "the mod said \"$SAID\", not Stopped."
  echo "   ok: stopped, and the marker Esc leaves is in its conversation"
fi

for id in "${IDS[@]}"; do
  if claude logs "$id" 2>&1 | grep -q "agent-tracker.*skipped"; then fail "a mod hook was skipped in session $id"; fi
done
echo "PASS"

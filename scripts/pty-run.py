#!/usr/bin/env python3
"""Runs a command in a pseudo-terminal (180x50) until it exits or this process is killed,
discarding its screen output. Used by e2e-answer.sh to drive an interactive Claude Code session."""
import fcntl, os, pty, select, signal, struct, sys, termios

pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 180, 0, 0))
signal.signal(signal.SIGTERM, lambda *_: (os.kill(pid, signal.SIGKILL), sys.exit(0)))
while True:
    ready, _, _ = select.select([fd], [], [], 1)
    if ready:
        try:
            if not os.read(fd, 65536):
                break
        except OSError:
            break

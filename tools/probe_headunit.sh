#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Read-only probe of an iDrive 7 head unit (MGU): what it has for showing YouTube.
# Run as root on the head unit:  sh probe_headunit.sh | tee /var/tmp/probe.txt
# Changes nothing; send the output back.

sec() { printf '\n== %s ==\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1 && printf '  %-18s %s\n' "$1" "$(command -v "$1")" || printf '  %-18s -\n' "$1"; }

sec "system"
uname -a
cat /etc/os-release 2>/dev/null | head -5
node -v 2>/dev/null | sed 's/^/node /'
free -m 2>/dev/null | head -2

sec "browsers / web engines"
for b in chromium chromium-browser google-chrome epiphany midori cog MiniBrowser qutebrowser surf luakit firefox; do have "$b"; done
ls /usr/lib 2>/dev/null | grep -i -E 'webkit|qtwebengine|cef|chromium|wpe' | sed 's/^/  lib: /'
ls /usr/lib/*/ 2>/dev/null | grep -i -E 'libwebkit|libQt5WebEngine|libcef|libWPE' | sed 's/^/  lib: /'
ls /opt 2>/dev/null | sed 's/^/  \/opt: /'

sec "media"
for m in mpv ffmpeg ffplay ffprobe gst-launch-1.0 gst-inspect-1.0 vlc yt-dlp youtube-dl python3 curl wget; do have "$m"; done
if command -v gst-inspect-1.0 >/dev/null 2>&1; then
  gst-inspect-1.0 2>/dev/null | grep -i -E 'h264|h265|vp9|vp8|av1|v4l2|vaapi|omx|mpeg4|aac|opus|waylandsink|kmssink|glimagesink' | head -30
fi

sec "display / gpu"
ls -l /dev/dri /dev/video* 2>/dev/null
ls /run/user/*/wayland-* /tmp/.X11-unix 2>/dev/null
ps ax 2>/dev/null | grep -i -E 'weston|wayland|xorg|renderd|cluster-render|inputgate|hmi' | grep -v grep | head -15

sec "services (display, audio, store)"
systemctl list-units --type=service --no-legend 2>/dev/null | grep -i -E 'render|input|waze|mgu|store|audio|pulse|alsa|browser|web|hmi|carplay' | head -40

sec "audio"
have aplay; have pactl
aplay -l 2>/dev/null | head -10
pactl info 2>/dev/null | head -5

sec "network (can the unit reach YouTube?)"
if command -v curl >/dev/null 2>&1; then
  curl -sS -m 8 -o /dev/null -w '  youtube.com/tv -> HTTP %{http_code}\n' https://www.youtube.com/tv 2>&1
  curl -sS -m 8 -o /dev/null -w '  m.youtube.com  -> HTTP %{http_code}\n' https://m.youtube.com/ 2>&1
elif command -v wget >/dev/null 2>&1; then
  wget -q -T 8 -O /dev/null https://www.youtube.com/tv && echo '  youtube.com/tv reachable' || echo '  youtube.com/tv NOT reachable'
else
  echo '  no curl/wget'
fi
ip -brief addr 2>/dev/null | head

sec "done"

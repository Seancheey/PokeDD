#!/bin/bash
# Mux bilibili-intro-v4.mp4: latest recording + Xiaoxiao narration
# + four pain-point text overlays during seg2 (8.0–20.6s).
set -euo pipefail

cd "$(dirname "$0")/.."

FONT='/System/Library/Fonts/Hiragino Sans GB.ttc'
COMMON="fontfile=${FONT}:fontsize=44:fontcolor=#FFD53D:borderw=3:bordercolor=black:box=1:boxcolor=black@0.7:boxborderw=16"

# seg2 starts at 8.0s and runs to 20.6s. Four pain points appear at the
# narration cues and persist through end of seg2.
PAIN1="drawtext=${COMMON}:text='① 中文资料不全？':x=(w-text_w)/2:y=h*0.22:enable='between(t,9.6,20.6)'"
PAIN2="drawtext=${COMMON}:text='② 选了不会配？':x=(w-text_w)/2:y=h*0.36:enable='between(t,11.6,20.6)'"
PAIN3="drawtext=${COMMON}:text='③ 伤害算不准？':x=(w-text_w)/2:y=h*0.50:enable='between(t,14.0,20.6)'"
PAIN4="drawtext=${COMMON}:text='④ 分享超麻烦？':x=(w-text_w)/2:y=h*0.64:enable='between(t,15.8,20.6)'"

ffmpeg -y \
  -i video-out/raw.webm \
  -i video-out/seg1.wav -i video-out/seg2.wav -i video-out/seg3.wav \
  -i video-out/seg4.wav -i video-out/seg5.wav -i video-out/seg6.wav \
  -filter_complex "\
[0:v]${PAIN1},${PAIN2},${PAIN3},${PAIN4}[vout];\
[1:a]adelay=0|0[a1];\
[2:a]adelay=8000|8000[a2];\
[3:a]adelay=20800|20800[a3];\
[4:a]adelay=30000|30000[a4];\
[5:a]adelay=58000|58000[a5];\
[6:a]adelay=80000|80000[a6];\
[a1][a2][a3][a4][a5][a6]amix=inputs=6:duration=longest:normalize=0,apad=whole_dur=87000ms[aout]" \
  -map '[vout]' -map '[aout]' \
  -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -r 30 \
  -c:a aac -b:a 192k \
  video-out/bilibili-intro-v4.mp4

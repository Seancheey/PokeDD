#!/bin/bash
# Mux bilibili-intro-v3.mp4: existing recording + Xiaoxiao narration
# + pain-point text overlays during seg2 (8.7–19.6s).
set -euo pipefail

cd "$(dirname "$0")/.."

FONT='/System/Library/Fonts/Hiragino Sans GB.ttc'
COMMON="fontfile=${FONT}:fontsize=46:fontcolor=#FFD53D:borderw=3:bordercolor=black:box=1:boxcolor=black@0.65:boxborderw=18"

# Each pain point stays from its in-time to the end of seg2 (19.6s).
# Centered horizontally, stacked vertically. Yellow text on dark box.
PAIN1="drawtext=${COMMON}:text='一、 选了不会配？':x=(w-text_w)/2:y=h*0.30:enable='between(t,10.5,19.6)'"
PAIN2="drawtext=${COMMON}:text='二、 伤害算不准？':x=(w-text_w)/2:y=h*0.45:enable='between(t,13.0,19.6)'"
PAIN3="drawtext=${COMMON}:text='三、 分享超麻烦？':x=(w-text_w)/2:y=h*0.60:enable='between(t,14.8,19.6)'"

ffmpeg -y \
  -i video-out/raw.webm \
  -i video-out/seg1.wav -i video-out/seg2.wav -i video-out/seg3.wav \
  -i video-out/seg4.wav -i video-out/seg5.wav -i video-out/seg6.wav \
  -filter_complex "\
[0:v]${PAIN1},${PAIN2},${PAIN3}[vout];\
[1:a]adelay=0|0[a1];\
[2:a]adelay=8700|8700[a2];\
[3:a]adelay=19700|19700[a3];\
[4:a]adelay=32000|32000[a4];\
[5:a]adelay=59000|59000[a5];\
[6:a]adelay=77000|77000[a6];\
[a1][a2][a3][a4][a5][a6]amix=inputs=6:duration=longest:normalize=0,apad=whole_dur=86000ms[aout]" \
  -map '[vout]' -map '[aout]' \
  -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -r 30 \
  -c:a aac -b:a 192k \
  video-out/bilibili-intro-v3.mp4

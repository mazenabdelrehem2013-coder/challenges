#!/usr/bin/env bash
# Cuts "The Last Bloom" (30 s, 1920x1080, 24 fps) from the keyframes, the one real clip and the score.
# Usage: build.sh <work dir with kf/, clips/, audio/> <output.mp4>
# Shots without a real clip are slow camera moves over their keyframe; replace a shot by
# dropping its clip into clips/ and switching its line in the SHOTS section to "clip".
set -euo pipefail
W=${1:?work dir}; OUT=${2:?output file}
T="$W/tmp"; mkdir -p "$T"
FPS=24
ENC=(-c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -r $FPS -an)
FONT=$(fc-match -f '%{file}' 'Inter Display:light')

# Keyframes carry ~44 px black bars left and right: crop to the picture, keep 16:9, upscale for smooth moves.
prep() { ffmpeg -loglevel error -y -i "$1" -vf "crop=1286:723:45:22,scale=3840:2160:flags=lanczos" "$2"; }

# still <img> <seconds> <zoom from> <zoom to> <centre x 0-1> <centre y 0-1> <extra filters> <out>
still() {
  local n; n=$(python3 -c "print(round($2*$FPS))")
  ffmpeg -loglevel error -y -i "$1" -filter_complex "\
zoompan=z='$3+($4-$3)*on/($n-1)':x='(iw-iw/zoom)*$5':y='(ih-ih/zoom)*$6':d=$n:s=1920x1080:fps=$FPS,\
setsar=1,format=yuv420p${7:+,$7}" "${ENC[@]}" -frames:v $n "$8"
}

for i in 1 2 3 5 6; do prep "$W"/kf/${i}_*[0-9].png "$T/k$i.png"; done

# --- SHOTS ---------------------------------------------------------------------------------------
# 1  S01-SH01  5.0 s  exterior, slow push in, rain layered on top
N1=$((5*FPS))
ffmpeg -loglevel error -y -i "$T/k1.png" -f lavfi -i "color=black:s=960x540:r=$FPS:d=5" -filter_complex "\
[0]zoompan=z='1+0.08*on/($N1-1)':x='(iw-iw/zoom)*0.5':y='(ih-ih/zoom)*0.55':d=$N1:s=1920x1080:fps=$FPS,setsar=1,format=gbrp[bg];\
[1]noise=alls=100:allf=t+u,lutyuv=y='if(gt(val,247),255,0)':u=128:v=128,avgblur=sizeX=1:sizeY=14,\
rotate=0.18:fillcolor=black,scale=1920:1080,eq=brightness=0.02:contrast=1.6,format=gbrp[rain];\
[bg][rain]blend=all_mode=screen:all_opacity=0.55,format=yuv420p,eq=brightness=-0.02" "${ENC[@]}" -frames:v $N1 "$T/s1.mp4"

# 2  S01-SH02  5.0 s  Pip waters the flower: gentle push in toward Pip and the flower
still "$T/k2.png" 5 1.0 1.07 0.52 0.62 "" "$T/s2.mp4"

# 3  S01-SH03  4.0 s  tilt up from Pip to the roof, two lightning flashes
still "$T/k3.png" 4 1.18 1.18 0.5 "(1-on/($((4*FPS))-1))" \
  "eq=eval=frame:brightness='0.38*exp(-pow((t-0.9)/0.05,2))+0.26*exp(-pow((t-1.2)/0.06,2))':contrast='1+0.25*exp(-pow((t-0.9)/0.08,2))'" "$T/s3.mp4"

# 4  S01-SH04  6.0 s  the real clip: 0.4 s to 6.4 s, bars cropped, dip to black on the last frames
ffmpeg -loglevel error -y -ss 0.4 -t 6 -i "$W/clips/4_S01-SH04_T1.mp4" -vf \
  "crop=1824:1026:48:27,scale=1920:1080:flags=lanczos,setsar=1,fade=out:st=5.7:d=0.3,format=yuv420p" "${ENC[@]}" -frames:v $((6*FPS)) "$T/s4.mp4"

# 5  S02-SH01  5.0 s  dawn: very slow push in on the motionless Pip, light warming up
still "$T/k5.png" 5 1.0 1.05 0.5 0.6 "eq=eval=frame:brightness='-0.06+0.06*t/5',fade=in:st=0:d=0.5" "$T/s5.mp4"

# 6  S02-SH02  3.5 s  close on the flower; Pip's eye flickers once, then glows softly
N6=$(python3 -c "print(round(3.5*$FPS))")
ffmpeg -loglevel error -y -i "$T/k6.png" \
  -f lavfi -i "color=c=0xFFB24A@0.0:s=240x240:d=3.5:r=$FPS,format=rgba" -filter_complex "\
[0]zoompan=z='1+0.07*on/($N6-1)':x='(iw-iw/zoom)*0.5':y='(ih-ih/zoom)*0.45':d=$N6:s=1920x1080:fps=$FPS,setsar=1,format=rgba[bg];\
[1]geq=r=255:g=178:b=74:a='255*exp(-(pow(X-120,2)+pow(Y-120,2))/1300)',split[g1][g2];\
[g1]fade=in:st=1.6:d=0.06:alpha=1,fade=out:st=1.72:d=0.25:alpha=1[flick];\
[g2]colorchannelmixer=aa=0.55,fade=in:st=2.3:d=0.9:alpha=1[soft];\
[bg][flick]overlay=x=966-120:y=26-120[a];[a][soft]overlay=x=966-120:y=20-120,format=yuv420p" "${ENC[@]}" -frames:v $N6 "$T/s6.mp4"

# 7  end title  1.5 s
ffmpeg -loglevel error -y -f lavfi -i "color=black:s=1920x1080:r=$FPS:d=1.5" -vf \
  "drawtext=fontfile='$FONT':text='THE LAST BLOOM':fontsize=54:fontcolor=0xE8E2D6:x=(w-tw)/2:y=(h-th)/2:alpha='min(1,t/0.5)',format=yuv420p" \
  "${ENC[@]}" "$T/s7.mp4"

# --- CUT -----------------------------------------------------------------------------------------
printf "file '%s'\n" "$T"/s{1..7}.mp4 > "$T/list.txt"
ffmpeg -loglevel error -y -f concat -safe 0 -i "$T/list.txt" -c copy "$T/picture.mp4"
ffmpeg -loglevel error -y -i "$T/picture.mp4" -i "$W/audio/score.mp3" -filter_complex \
  "[0:v]fade=in:st=0:d=0.8,format=yuv420p[v];[1:a]afade=out:st=28.3:d=1.7,apad[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -c:a aac -b:a 192k \
  -t 30 -movflags +faststart "$OUT"
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of compact "$OUT"

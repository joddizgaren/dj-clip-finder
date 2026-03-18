Place the Windows FFmpeg binaries here before building the installer:

  ffmpeg.exe   — required
  ffprobe.exe  — required

Download URL:
  https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip

Steps:
  1. Download the zip above
  2. Open it and go to bin\
  3. Copy ffmpeg.exe and ffprobe.exe into this folder (electron/ffmpeg/)
  4. Then run:  npx tsx script/build.electron.ts

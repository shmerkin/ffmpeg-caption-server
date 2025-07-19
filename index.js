// ffmpeg-caption-server/index.js

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const { exec } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const FormData = require("form-data");

const app = express();
const port = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.use(express.json());

app.get("/ping", (req, res) => {
  res.json({ status: "ok" });
});

// Helper: Convert Whisper verbose_json to SRT format
function convertVerboseJsonToSRT(segments) {
  return segments
    .map((seg, index) => {
      const start = new Date(seg.start * 1000).toISOString().substr(11, 12).replace('.', ',');
      const end = new Date(seg.end * 1000).toISOString().substr(11, 12).replace('.', ',');
      return `${index + 1}\n${start} --> ${end}\n${seg.text.trim()}\n`;
    })
    .join("\n");
}

// Step 1: Generate subtitles (with verbose_json parsing)
app.post("/generate-subtitles", async (req, res) => {
  const { video_url } = req.body;
  const id = uuidv4();
  const videoPath = `./${id}.mp4`;
  const srtPath = `./${id}.srt`;

  try {
    const video = await axios.get(video_url, { responseType: "stream" });
    const videoWriter = fs.createWriteStream(videoPath);
    await new Promise((resolve) => {
      video.data.pipe(videoWriter);
      videoWriter.on("finish", resolve);
    });

    const formData = new FormData();
    formData.append("file", fs.createReadStream(videoPath));
    formData.append("model", "whisper-1");
    formData.append("response_format", "verbose_json");

    const whisperResponse = await axios.post(
      "https://api.openai.com/v1/audio/translations",
      formData,
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          ...formData.getHeaders()
        },
      }
    );

    const srtContent = convertVerboseJsonToSRT(whisperResponse.data.segments);
    fs.writeFileSync(srtPath, srtContent);

    res.sendFile(srtPath, { root: __dirname });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error generating subtitles" });
  } finally {
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
  }
});

// Step 2: Burn subtitles with style
app.post("/burn-subtitles", async (req, res) => {
  const { video_url, srt_url, font_url, style } = req.body;
  const id = uuidv4();
  const videoPath = `./${id}.mp4`;
  const srtPath = `./${id}.srt`;
  const fontPath = `./${id}.ttf`;
  const outputPath = `./${id}_captioned.mp4`;

  try {
    const [video, srt, font] = await Promise.all([
      axios.get(video_url, { responseType: "stream" }),
      axios.get(srt_url, { responseType: "stream" }),
      axios.get(font_url, { responseType: "stream" }),
    ]);

    await Promise.all([
      new Promise((resolve) => video.data.pipe(fs.createWriteStream(videoPath)).on("finish", resolve)),
      new Promise((resolve) => srt.data.pipe(fs.createWriteStream(srtPath)).on("finish", resolve)),
      new Promise((resolve) => font.data.pipe(fs.createWriteStream(fontPath)).on("finish", resolve)),
    ]);

    const fontName = fontPath.split("/").pop().replace(".ttf", "");
    const styleParams = style || [
      `FontName=${fontName}`,
      `FontSize=24`,
      `PrimaryColour=&H00E0E0E0`,
      `Outline=2`,
      `OutlineColour=&H00000000`,
      `Shadow=1`,
      `BackColour=&H80000000`,
      `BorderStyle=1`,
      `MarginV=60`,
      `Alignment=2`,
    ].join(",");

    const cmd = `ffmpeg -i ${videoPath} -vf "subtitles=${srtPath}:force_style='${styleParams}'" -c:a copy ${outputPath}`;

    await new Promise((resolve, reject) => {
      exec(cmd, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    res.download(outputPath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error burning subtitles" });
  } finally {
    [videoPath, srtPath, fontPath, outputPath].forEach((p) => {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
  }
});

app.listen(port, () => {
  console.log(`🔥 FFmpeg Caption Server running on port ${port}`);
});

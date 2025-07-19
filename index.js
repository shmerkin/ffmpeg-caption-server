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

// פונקציה שממירה verbose_json ל-SRT עם פיצול לפי פסיקים/נקודות
function convertVerboseJsonToSRT(segments) {
  const lines = [];
  let index = 1;

  segments.forEach((seg) => {
    const parts = seg.text.split(/(?<=[.,!?])\s+/); // ← פיצול לפי פסיקים וסיום משפט
    const startBase = seg.start;
    const endBase = seg.end;
    const totalParts = parts.length;

    parts.forEach((part, i) => {
      const partStart = startBase + ((endBase - startBase) * i) / totalParts;
      const partEnd = startBase + ((endBase - startBase) * (i + 1)) / totalParts;

      const start = new Date(partStart * 1000).toISOString().substr(11, 12).replace(".", ",");
      const end = new Date(partEnd * 1000).toISOString().substr(11, 12).replace(".", ",");

      lines.push(`${index++}\n${start} --> ${end}\n${part.trim()}\n`);
    });
  });

  return lines.join("\n");
}

// שלב 1: יצירת כתוביות
app.post("/generate-subtitles", async (req, res) => {
  const { video_url } = req.body;
  const id = uuidv4();
  const videoPath = `./${id}.mp4`;
  const srtPath = `./${id}.srt`;

  try {
    const video = await axios.get(video_url, { responseType: "stream" });
    await new Promise((resolve) => video.data.pipe(fs.createWriteStream(videoPath)).on("finish", resolve));

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
          ...formData.getHeaders(),
        },
      }
    );

    const srtContent = convertVerboseJsonToSRT(whisperResponse.data.segments);
    fs.writeFileSync(srtPath, srtContent);

    res.sendFile(srtPath, { root: __dirname });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error generating subtitles" });
  }
});

// שלב 2: צריבת כתוביות
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
    const defaultStyle = `FontName=${fontName},FontSize=28,PrimaryColour=&H00E0E0E0,Outline=2,OutlineColour=&H00000000,Shadow=1,BackColour=&H80000000,BorderStyle=1,MarginV=60,Alignment=2`;
    const styleParams = style || defaultStyle;

    const cmd = `ffmpeg -i ${videoPath} -vf "subtitles=${srtPath}:force_style='${styleParams}'" -c:a copy ${outputPath}`;

    await new Promise((resolve, reject) => {
      exec(cmd, (err) => (err ? reject(err) : resolve()));
    });

    res.download(outputPath, (err) => {
      if (err) console.error("Download error:", err);
      [videoPath, srtPath, fontPath, outputPath].forEach((p) => {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error burning subtitles" });
  }
});

app.listen(port, () => {
  console.log(`🔥 FFmpeg Caption Server running on port ${port}`);
});

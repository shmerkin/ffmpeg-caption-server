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

// שלב 1: הפקת כתוביות בלבד
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
    formData.append("response_format", "srt");

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

    fs.writeFileSync(srtPath, whisperResponse.data);
    res.sendFile(srtPath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error generating subtitles" });
  } finally {
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
  }
});

// שלב 2: צריבה של כתוביות עם שליטה על מיקום, צבע ופונט
app.post("/burn-subtitles", async (req, res) => {
  const { video_url, srt_url, font_url, style } = req.body;
  const id = uuidv4();
  const videoPath = `./${id}.mp4`;
  const srtPath = `./${id}.srt`;
  const fontPath = `./${id}.ttf`;
  const outputPath = `./${id}_captioned.mp4`;

  try {
    // הורדת קבצים
    const [video, srt, font] = await Promise.all([
      axios.get(video_url, { responseType: "stream" }),
      axios.get(srt_url, { responseType: "stream" }),
      axios.get(font_url, { responseType: "stream" })
    ]);

    await Promise.all([
      new Promise((resolve) => video.data.pipe(fs.createWriteStream(videoPath)).on("finish", resolve)),
      new Promise((resolve) => srt.data.pipe(fs.createWriteStream(srtPath)).on("finish", resolve)),
      new Promise((resolve) => font.data.pipe(fs.createWriteStream(fontPath)).on("finish", resolve))
    ]);

    const styleParams = style || "FontName=Arial,FontSize=28,PrimaryColour=&H00FFFFFF,Alignment=2";
    const cmd = `ffmpeg -i ${videoPath} -vf "subtitles=${srtPath}:fontsdir=./:force_style='${styleParams}'" -c:a copy ${outputPath}`;

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
  console.log(`Server running on port ${port}`);
});

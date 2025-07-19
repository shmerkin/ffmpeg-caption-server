// ffmpeg-caption-server/index.js

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const { exec } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const app = express();
const port = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.use(express.json());

app.get("/ping", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/add-captions", async (req, res) => {
  const { video_url, font_url } = req.body;
  const id = uuidv4();
  const videoPath = `./${id}.mp4`;
  const srtPath = `./${id}.srt`;
  const outputPath = `./${id}_captioned.mp4`;
  const fontPath = `./${id}.ttf`;

  try {
    // 1. Download video
    const video = await axios.get(video_url, { responseType: "stream" });
    const videoWriter = fs.createWriteStream(videoPath);
    await new Promise((resolve) => {
      video.data.pipe(videoWriter);
      videoWriter.on("finish", resolve);
    });

    // 2. Download font
    const font = await axios.get(font_url, { responseType: "stream" });
    const fontWriter = fs.createWriteStream(fontPath);
    await new Promise((resolve) => {
      font.data.pipe(fontWriter);
      fontWriter.on("finish", resolve);
    });

    // 3. Send to Whisper
    const whisperResponse = await axios.post(
      "https://api.openai.com/v1/audio/translations",
      {
        file: fs.createReadStream(videoPath),
        model: "whisper-1",
        response_format: "srt",
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "multipart/form-data",
        },
      }
    );
    fs.writeFileSync(srtPath, whisperResponse.data);

    // 4. Run FFmpeg
    await new Promise((resolve, reject) => {
      const cmd = `ffmpeg -i ${videoPath} -vf "subtitles=${srtPath}:force_style='FontName=${fontPath},FontSize=28,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=1'" -c:a copy ${outputPath}`;
      exec(cmd, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // 5. Respond with file (or upload to Dropbox here)
    res.download(outputPath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  } finally {
    // Cleanup
    [videoPath, srtPath, outputPath, fontPath].forEach((p) => {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

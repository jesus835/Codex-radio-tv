const express = require("express");
const { exec, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;
const YTDLP_PATH = path.join(__dirname, "yt-dlp.exe");

if (!fs.existsSync("videos")) {
    fs.mkdirSync("videos");
}

app.use(express.static("public"));
app.use("/videos", express.static("videos"));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/descargar", (req, res) => {
    const url = req.query.url;
    
    if (!url) {
        return res.status(400).send("URL es requerida");
    }

    const timestamp = Date.now();
    const filename = `video_${timestamp}.mp4`;
    const outputPath = `videos/${filename}`;

    console.log(`Descargando video: ${url}`);

    exec(`"${YTDLP_PATH}" -o "${outputPath}" "${url}"`, (error, stdout, stderr) => {
        if (error) {
            console.error("Error:", error);
            return res.status(500).json({ 
                error: "Error descargando video",
                details: stderr 
            });
        }

        console.log("Video descargado exitosamente");
        res.json({ 
            success: true,
            message: "Video descargado",
            filename: filename,
            videoUrl: `/videos/${filename}`
        });
    });
});

app.get("/stream", (req, res) => {
    const url = req.query.url;
    
    if (!url) {
        return res.status(400).send("URL es requerida");
    }

    console.log(`Streaming video: ${url}`);

    const ytdlp = spawn(YTDLP_PATH, [
        "-f", "best[ext=mp4]",
        "-o", "-",
        url
    ]);

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");

    ytdlp.stdout.pipe(res);

    ytdlp.stderr.on("data", (data) => {
        console.error(`yt-dlp: ${data}`);
    });

    ytdlp.on("error", (error) => {
        console.error("Error ejecutando yt-dlp:", error);
        if (!res.headersSent) {
            res.status(500).send("Error al hacer streaming del video");
        }
    });

    ytdlp.on("close", (code) => {
        console.log(`yt-dlp proceso terminado con código ${code}`);
    });

    req.on("close", () => {
        ytdlp.kill();
    });
});

app.get("/info", (req, res) => {
    const url = req.query.url;
    
    if (!url) {
        return res.status(400).send("URL es requerida");
    }

    exec(`"${YTDLP_PATH}" -J "${url}"`, (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ 
                error: "Error obteniendo información del video",
                details: stderr 
            });
        }

        try {
            const info = JSON.parse(stdout);
            res.json({
                title: info.title,
                duration: info.duration,
                thumbnail: info.thumbnail,
                uploader: info.uploader,
                description: info.description
            });
        } catch (e) {
            res.status(500).json({ error: "Error parseando información" });
        }
    });
});

app.get("/videos-list", (req, res) => {
    fs.readdir("videos", (err, files) => {
        if (err) {
            return res.status(500).json({ error: "Error listando videos" });
        }
        
        const videoFiles = files.filter(file => file.endsWith(".mp4"));
        res.json({ videos: videoFiles });
    });
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    console.log(`Asegúrate de tener yt-dlp instalado en tu sistema`);
});

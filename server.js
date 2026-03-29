const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });

// Health check
app.get('/', (req, res) => {
    res.send('Bairan Effect Server Running!');
});

// Process video endpoint
app.post('/process', upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'music', maxCount: 1 },
    { name: 'photos', maxCount: 50 }
]), async (req, res) => {
    const jobId = Date.now().toString();
    const workDir = path.join(__dirname, 'temp', jobId);
    
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(path.join(workDir, 'output'), { recursive: true });
    
    try {
        const videoPath = req.files['video'][0].path;
        const musicPath = req.files['music']?.[0]?.path;
        const photos = req.files['photos'] || [];
        
        // Step 1: Convert video to MP4
        const mainVideo = path.join(workDir, 'main.mp4');
        await runFFmpeg(`ffmpeg -i "${videoPath}" -c:v libx264 -c:a aac "${mainVideo}"`);
        
        // Step 2: Extract last frame
        const lastFrame = path.join(workDir, 'lastframe.png');
        await runFFmpeg(`ffmpeg -sseof -1 -i "${mainVideo}" -vsync 0 -q:v 1 -update true "${lastFrame}"`);
        
        // Step 3: Create slideshow from photos
        const slideshow = path.join(workDir, 'slideshow.mp4');
        if (photos.length > 0) {
            // Create file list
            const listFile = path.join(workDir, 'photos.txt');
            let listContent = '';
            photos.forEach((photo, i) => {
                listContent += `file '${photo.path}'\nduration 0.3\n`;
            });
            fs.writeFileSync(listFile, listContent);
            
            await runFFmpeg(`ffmpeg -f concat -safe 0 -i "${listFile}" -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,format=yuv420p" -c:v libx264 -r 30 "${slideshow}"`);
        }
        
        // Step 4: Compose final video
        const outputVideo = path.join(workDir, 'output', 'final.mp4');
        let ffmpegCmd = `ffmpeg -i "${mainVideo}" `;
        
        if (photos.length > 0) {
            ffmpegCmd += `-i "${slideshow}" `;
        }
        if (musicPath) {
            ffmpegCmd += `-i "${musicPath}" `;
        }
        
        ffmpegCmd += `-filter_complex "[0:v]scale=1080:1920[main];`;
        if (photos.length > 0) {
            ffmpegCmd += `[1:v]scale=1080:1920[slide];[main][slide]overlay=0:0:enable='between(t,${getVideoDuration(mainVideo)},999)'[v];`;
        } else {
            ffmpegCmd += `[main]copy[v];`;
        }
        ffmpegCmd += `" -map "[v]" `;
        
        if (musicPath) {
            ffmpegCmd += `-map 2:a -c:a aac -shortest `;
        }
        
        ffmpegCmd += `-c:v libx264 -pix_fmt yuv420p "${outputVideo}"`;
        
        await runFFmpeg(ffmpegCmd);
        
        // Send file
        res.download(outputVideo, 'bairan-effect.mp4', (err) => {
            // Cleanup
            fs.rmSync(workDir, { recursive: true, force: true });
        });
        
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

function runFFmpeg(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { timeout: 300000 }, (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function getVideoDuration(videoPath) {
    return new Promise((resolve) => {
        exec(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`, (err, stdout) => {
            if (err) resolve(5);
            else resolve(parseFloat(stdout) || 5);
        });
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));

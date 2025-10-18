const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const contentDisposition = require('content-disposition');

const app = express();
const PORT = process.env.PORT || 3000;
const isDevelopment = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';

// Platform detection
const isWindows = process.platform === 'win32';
const isRender = process.env.RENDER === 'true';

console.log(`🏁 Platform: ${process.platform}`);
console.log(`🌐 Environment: ${isRender ? 'Render' : 'Local'}`);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Enhanced logging middleware
app.use((req, res, next) => {
    if (isDevelopment) {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    }
    next();
});

// Create downloads directory
const downloadsDir = isRender 
    ? '/tmp/yt-dlp-downloads'  // Render uses /tmp
    : path.join(__dirname, 'downloads');  // Local uses project directory

if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
    console.log(`📁 Created downloads directory: ${downloadsDir}`);
}

// Platform-specific binary paths
const ytDlpPath = isWindows 
    ? path.join(__dirname, 'yt-dlp.exe')
    : path.join(__dirname, 'yt-dlp');

const ffmpegDir = path.join(__dirname, 'ffmpeg');
const ffmpegPath = isWindows
    ? path.join(ffmpegDir, 'bin', 'ffmpeg.exe')
    : path.join(ffmpegDir, 'ffmpeg');

// Check if dependencies are available
async function checkDependencies() {
    const dependencies = {
        ytDlp: false,
        ffmpeg: false
    };

    console.log('🔍 Checking dependencies...');

    // Check yt-dlp
    try {
        if (fs.existsSync(ytDlpPath)) {
            if (!isWindows) {
                // Ensure executable permissions on Linux
                fs.chmodSync(ytDlpPath, 0o755);
            }
            
            const version = await execPromise(`"${ytDlpPath}" --version`);
            console.log(`✅ yt-dlp is available - Version: ${version.trim()}`);
            dependencies.ytDlp = true;
        } else {
            console.log('❌ yt-dlp not found at:', ytDlpPath);
        }
    } catch (error) {
        console.log('❌ yt-dlp check failed:', error.message);
    }

    // Check FFmpeg
    try {
        if (fs.existsSync(ffmpegPath)) {
            if (!isWindows) {
                // Ensure executable permissions on Linux
                fs.chmodSync(ffmpegPath, 0o755);
            }
            
            const version = await execPromise(`"${ffmpegPath}" -version`);
            const versionLine = version.split('\n')[0];
            console.log(`✅ FFmpeg is available - ${versionLine}`);
            dependencies.ffmpeg = true;
        } else {
            console.log('❌ FFmpeg not found at:', ffmpegPath);
            // Try alternative path for Windows
            if (isWindows) {
                const altPath = path.join(ffmpegDir, 'ffmpeg.exe');
                if (fs.existsSync(altPath)) {
                    console.log(`✅ FFmpeg found at alternative path: ${altPath}`);
                    dependencies.ffmpeg = true;
                }
            }
        }
    } catch (error) {
        console.log('❌ FFmpeg check failed:', error.message);
    }

    return dependencies;
}

// Promisified exec for dependency checks
function execPromise(command) {
    return new Promise((resolve, reject) => {
        const { exec } = require('child_process');
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve(stdout);
            }
        });
    });
}

// Utility function to validate URL
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// Utility function to clean filename
function cleanFilename(filename) {
    if (!filename) return 'unknown';
    return filename.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
}

// Utility function to cleanup old files
function cleanupOldFiles() {
    try {
        if (!fs.existsSync(downloadsDir)) return;
        
        const files = fs.readdirSync(downloadsDir);
        const now = Date.now();
        const maxAge = 30 * 60 * 1000; // 30 minutes
        
        files.forEach(file => {
            const filePath = path.join(downloadsDir, file);
            try {
                const stats = fs.statSync(filePath);
                if (now - stats.mtime.getTime() > maxAge) {
                    fs.unlinkSync(filePath);
                    console.log(`🧹 Cleaned up old file: ${file}`);
                }
            } catch (error) {
                console.error(`Error cleaning up file ${file}:`, error);
            }
        });
    } catch (error) {
        console.error('Error during cleanup:', error);
    }
}

// Run cleanup every 10 minutes
setInterval(cleanupOldFiles, 10 * 60 * 1000);

// Get video info using yt-dlp
async function getVideoInfo(url) {
    return new Promise((resolve, reject) => {
        const args = [
            '--dump-json',
            '--no-playlist',
            url
        ];
        
        console.log(`🔍 Getting info: ${ytDlpPath} ${args.join(' ')}`);
        
        const ytDlpProcess = spawn(ytDlpPath, args);
        let stdout = '';
        let stderr = '';
        
        ytDlpProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        ytDlpProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        ytDlpProcess.on('close', (code) => {
            if (code === 0) {
                try {
                    const info = JSON.parse(stdout);
                    resolve(info);
                } catch (parseError) {
                    reject(new Error(`Failed to parse video info: ${parseError.message}`));
                }
            } else {
                reject(new Error(`yt-dlp failed with code ${code}: ${stderr}`));
            }
        });
        
        ytDlpProcess.on('error', (error) => {
            reject(new Error(`Failed to spawn yt-dlp: ${error.message}`));
        });
    });
}

// Download video/audio using yt-dlp
async function downloadMedia(url, options) {
    return new Promise((resolve, reject) => {
        const args = [
            '--no-playlist',
            ...options.args,
            '-o', options.output,
            url
        ];

        // Add FFmpeg path if available
        if (fs.existsSync(ffmpegPath)) {
            args.push('--ffmpeg-location', path.dirname(ffmpegPath));
        }
        
        console.log(`📥 Downloading: ${ytDlpPath} ${args.join(' ')}`);
        
        const ytDlpProcess = spawn(ytDlpPath, args);
        let stderr = '';
        let stdout = '';
        
        ytDlpProcess.stderr.on('data', (data) => {
            stderr += data.toString();
            if (isDevelopment) {
                process.stderr.write(data);
            }
        });
        
        ytDlpProcess.stdout.on('data', (data) => {
            stdout += data.toString();
            if (isDevelopment) {
                process.stdout.write(data);
            }
        });
        
        ytDlpProcess.on('close', (code) => {
            if (code === 0) {
                resolve({ success: true, stdout, stderr });
            } else {
                reject(new Error(`yt-dlp failed with code ${code}: ${stderr}`));
            }
        });
        
        ytDlpProcess.on('error', (error) => {
            reject(new Error(`Failed to spawn yt-dlp: ${error.message}`));
        });
    });
}

// Find downloaded file
function findDownloadedFile(baseName) {
    const files = fs.readdirSync(downloadsDir);
    return files.find(file => file.includes(baseName) && !file.endsWith('.part'));
}

// Endpoint 1: Get video info
app.get('/v-i', async (req, res) => {
    try {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL parameter is required'
            });
        }
        
        if (!isValidUrl(url)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid URL provided'
            });
        }
        
        console.log(`🔍 Fetching info for URL: ${url}`);
        
        const videoInfo = await getVideoInfo(url);
        
        // Extract relevant information
        const info = {
            id: videoInfo.id,
            title: videoInfo.title,
            duration: videoInfo.duration,
            uploader: videoInfo.uploader,
            upload_date: videoInfo.upload_date,
            view_count: videoInfo.view_count,
            like_count: videoInfo.like_count,
            thumbnail: videoInfo.thumbnail,
            description: videoInfo.description,
            formats: videoInfo.formats ? videoInfo.formats.map(format => ({
                format_id: format.format_id,
                ext: format.ext,
                resolution: format.resolution,
                filesize: format.filesize,
                format_note: format.format_note
            })) : []
        };
        
        console.log(`✅ Successfully fetched info for: ${videoInfo.title}`);
        
        res.json({
            success: true,
            data: info
        });
        
    } catch (error) {
        console.error('❌ Error fetching video info:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch video information'
        });
    }
});

// Endpoint 2: Download video as MP4
app.get('/v-dl', async (req, res) => {
    let tempFilePath = null;
    
    try {
        const { url, quality = 'best' } = req.query;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL parameter is required'
            });
        }
        
        if (!isValidUrl(url)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid URL provided'
            });
        }
        
        console.log(`📥 Downloading video from URL: ${url}`);
        
        // First get video info for filename
        const videoInfo = await getVideoInfo(url);
        const cleanTitle = cleanFilename(videoInfo.title);
        const filename = `${cleanTitle}.mp4`;
        const baseName = `${Date.now()}_${cleanTitle}`;
        tempFilePath = path.join(downloadsDir, baseName);
        
        // Download video as MP4
        await downloadMedia(url, {
            output: tempFilePath,
            args: [
                '-f', 'best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',
                '--merge-output-format', 'mp4'
            ]
        });
        
        // Find the actual downloaded file
        const downloadedFile = findDownloadedFile(baseName);
        if (!downloadedFile) {
            throw new Error('Downloaded file not found');
        }
        
        const actualFilePath = path.join(downloadsDir, downloadedFile);
        
        // Set headers and send file
        res.setHeader('Content-Disposition', contentDisposition(filename));
        res.setHeader('Content-Type', 'video/mp4');
        
        const fileStream = fs.createReadStream(actualFilePath);
        fileStream.pipe(res);
        
        fileStream.on('end', () => {
            // Cleanup file after sending
            try {
                if (fs.existsSync(actualFilePath)) {
                    fs.unlinkSync(actualFilePath);
                }
            } catch (cleanupError) {
                console.error('Error cleaning up temp file:', cleanupError);
            }
        });
        
        fileStream.on('error', (error) => {
            console.error('File stream error:', error);
            res.status(500).json({
                success: false,
                error: 'File stream error'
            });
        });
        
    } catch (error) {
        console.error('❌ Error downloading video:', error);
        
        // Cleanup temp file on error
        if (tempFilePath) {
            const files = fs.readdirSync(downloadsDir).filter(f => f.includes(path.basename(tempFilePath)));
            files.forEach(file => {
                try {
                    fs.unlinkSync(path.join(downloadsDir, file));
                } catch (cleanupError) {
                    console.error('Error cleaning up temp file on error:', cleanupError);
                }
            });
        }
        
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to download video'
        });
    }
});

// Endpoint 3: Download audio as MP3
app.get('/a-dl', async (req, res) => {
    let tempFilePath = null;
    
    try {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL parameter is required'
            });
        }
        
        if (!isValidUrl(url)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid URL provided'
            });
        }
        
        console.log(`🎵 Downloading audio from URL: ${url}`);
        
        // First get video info for filename
        const videoInfo = await getVideoInfo(url);
        const cleanTitle = cleanFilename(videoInfo.title);
        const filename = `${cleanTitle}.mp3`;
        const baseName = `${Date.now()}_${cleanTitle}`;
        tempFilePath = path.join(downloadsDir, baseName);
        
        // Download audio as MP3 with FFmpeg conversion
        await downloadMedia(url, {
            output: tempFilePath,
            args: [
                '-f', 'bestaudio',
                '--extract-audio',
                '--audio-format', 'mp3',
                '--audio-quality', '0'  // Best quality
            ]
        });
        
        // Find the actual downloaded file
        const downloadedFile = findDownloadedFile(baseName);
        if (!downloadedFile) {
            throw new Error('Downloaded file not found');
        }
        
        const actualFilePath = path.join(downloadsDir, downloadedFile);
        
        // Set headers and send file
        res.setHeader('Content-Disposition', contentDisposition(filename));
        res.setHeader('Content-Type', 'audio/mpeg');
        
        const fileStream = fs.createReadStream(actualFilePath);
        fileStream.pipe(res);
        
        fileStream.on('end', () => {
            // Cleanup file after sending
            try {
                if (fs.existsSync(actualFilePath)) {
                    fs.unlinkSync(actualFilePath);
                }
            } catch (cleanupError) {
                console.error('Error cleaning up temp file:', cleanupError);
            }
        });
        
        fileStream.on('error', (error) => {
            console.error('File stream error:', error);
            res.status(500).json({
                success: false,
                error: 'File stream error'
            });
        });
        
    } catch (error) {
        console.error('❌ Error downloading audio:', error);
        
        // Cleanup temp file on error
        if (tempFilePath) {
            const files = fs.readdirSync(downloadsDir).filter(f => f.includes(path.basename(tempFilePath)));
            files.forEach(file => {
                try {
                    fs.unlinkSync(path.join(downloadsDir, file));
                } catch (cleanupError) {
                    console.error('Error cleaning up temp file on error:', cleanupError);
                }
            });
        }
        
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to download audio'
        });
    }
});

// Health check endpoint
app.get('/health', async (req, res) => {
    const dependencies = await checkDependencies();
    
    res.json({
        success: true,
        message: 'API is running',
        timestamp: new Date().toISOString(),
        platform: process.platform,
        environment: isRender ? 'render' : 'local',
        dependencies: dependencies
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('Global error handler:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// Start server
app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📹 Video info endpoint: GET /v-i?url=YOUTUBE_URL`);
    console.log(`📥 Video download endpoint: GET /v-dl?url=YOUTUBE_URL`);
    console.log(`🎵 Audio download endpoint: GET /a-dl?url=YOUTUBE_URL`);
    console.log(`❤️  Health check: GET /health`);
    console.log(`💾 Downloads directory: ${downloadsDir}`);
    
    // Check dependencies on startup
    const dependencies = await checkDependencies();
    if (!dependencies.ytDlp || !dependencies.ffmpeg) {
        console.log('⚠️  Some dependencies are missing. The service may not work correctly.');
        console.log('💡 Run: npm run build');
    }
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    cleanupOldFiles();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down server...');
    cleanupOldFiles();
    process.exit(0);
});
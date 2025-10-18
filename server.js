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
    ? '/tmp/yt-dlp-downloads'
    : path.join(__dirname, 'downloads');

if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
    console.log(`📁 Created downloads directory: ${downloadsDir}`);
}

// Use the Linux yt-dlp binary you provided
const ytDlpPath = path.join(__dirname, 'yt-dlp_linux');

// Make sure it's executable
if (!isWindows && fs.existsSync(ytDlpPath)) {
    try {
        fs.chmodSync(ytDlpPath, 0o755);
        console.log(`✅ Made yt-dlp_linux executable`);
    } catch (error) {
        console.log(`⚠️  Could not make yt-dlp_linux executable: ${error.message}`);
    }
}

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
                fs.chmodSync(ytDlpPath, 0o755);
            }
            
            const version = await execPromise(`"${ytDlpPath}" --version`);
            console.log(`✅ yt-dlp_linux is available - Version: ${version.trim()}`);
            dependencies.ytDlp = true;
        } else {
            console.log('❌ yt-dlp_linux not found at:', ytDlpPath);
            // Fallback to system yt-dlp
            try {
                const version = await execPromise('yt-dlp --version');
                console.log(`✅ System yt-dlp is available - Version: ${version.trim()}`);
                dependencies.ytDlp = true;
            } catch (systemError) {
                console.log('❌ System yt-dlp also not available');
            }
        }
    } catch (error) {
        console.log('❌ yt-dlp check failed:', error.message);
    }

    // Check FFmpeg
    try {
        if (fs.existsSync(ffmpegPath)) {
            if (!isWindows) {
                fs.chmodSync(ffmpegPath, 0o755);
            }
            
            const version = await execPromise(`"${ffmpegPath}" -version`);
            const versionLine = version.split('\n')[0];
            console.log(`✅ FFmpeg is available - ${versionLine}`);
            dependencies.ffmpeg = true;
        } else {
            console.log('❌ FFmpeg not found at:', ffmpegPath);
            const alternativePaths = [
                path.join(ffmpegDir, 'ffmpeg'),
                '/usr/bin/ffmpeg',
                '/usr/local/bin/ffmpeg'
            ];
            
            for (const altPath of alternativePaths) {
                if (fs.existsSync(altPath)) {
                    console.log(`✅ FFmpeg found at alternative path: ${altPath}`);
                    dependencies.ffmpeg = true;
                    break;
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

// Execute yt-dlp command
async function executeYtDlp(args) {
    return new Promise((resolve, reject) => {
        console.log(`🔄 Running: yt-dlp ${args.slice(0, 10).join(' ')}...`);
        
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
            if (code === 0 || stdout) {
                resolve({ success: true, stdout, stderr });
            } else {
                reject(new Error(stderr || `Exit code: ${code}`));
            }
        });
        
        ytDlpProcess.on('error', (error) => {
            reject(new Error(`Failed to spawn yt-dlp: ${error.message}`));
        });
        
        // Timeout after 60 seconds
        setTimeout(() => {
            ytDlpProcess.kill();
            reject(new Error('Timeout after 60 seconds'));
        }, 60000);
    });
}

// Get video info with multiple fallback methods
async function getVideoInfo(url) {
    const methods = [
        // Method 1: Mobile client with slow settings
        [
            '--dump-json',
            '--no-playlist', 
            '--ignore-errors',
            '--no-warnings',
            '--extractor-args', 'youtube:player-client=android',
            '--throttled-rate', '10K',
            '--sleep-requests', '5',
            url
        ],
        // Method 2: Different user agent
        [
            '--dump-json',
            '--no-playlist',
            '--ignore-errors',
            '--no-warnings',
            '--user-agent', 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
            '--sleep-interval', '3',
            url
        ],
        // Method 3: Minimal approach
        [
            '--dump-json', 
            '--no-playlist',
            '--ignore-errors',
            url
        ]
    ];

    for (let i = 0; i < methods.length; i++) {
        try {
            console.log(`🔍 Trying method ${i + 1} for: ${url}`);
            const result = await executeYtDlp(methods[i]);
            
            if (result.success && result.stdout) {
                const info = JSON.parse(result.stdout);
                if (info.id) {
                    console.log(`✅ Success with method ${i + 1}`);
                    return info;
                }
            }
        } catch (error) {
            console.log(`❌ Method ${i + 1} failed: ${error.message.substring(0, 100)}...`);
        }
        
        if (i < methods.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay
        }
    }
    
    throw new Error('All methods failed. YouTube is blocking requests from cloud servers.');
}

// Download media with multiple fallback methods
async function downloadMedia(url, options) {
    const methods = [
        // Method 1: Mobile client with slow settings
        [
            '--no-playlist',
            '--ignore-errors',
            '--no-warnings',
            '--extractor-args', 'youtube:player-client=android',
            '--throttled-rate', '10K',
            '--sleep-requests', '5',
            ...options.args,
            '-o', options.output,
            url
        ],
        // Method 2: Different user agent
        [
            '--no-playlist',
            '--ignore-errors', 
            '--no-warnings',
            '--user-agent', 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
            '--sleep-interval', '3',
            ...options.args,
            '-o', options.output, 
            url
        ],
        // Method 3: Minimal approach
        [
            '--no-playlist',
            '--ignore-errors',
            ...options.args,
            '-o', options.output,
            url
        ]
    ];

    // Add FFmpeg location to all methods
    if (fs.existsSync(ffmpegPath)) {
        methods.forEach(method => {
            method.splice(2, 0, '--ffmpeg-location', path.dirname(ffmpegPath));
        });
    }

    for (let i = 0; i < methods.length; i++) {
        try {
            console.log(`📥 Trying download method ${i + 1}`);
            await executeYtDlp(methods[i]);
            
            const baseName = path.basename(options.output);
            const downloadedFile = findDownloadedFile(baseName);
            if (downloadedFile) {
                console.log(`✅ Download successful with method ${i + 1}`);
                return { success: true };
            }
        } catch (error) {
            console.log(`❌ Download method ${i + 1} failed: ${error.message.substring(0, 100)}...`);
            cleanupPartialFiles(options.output);
        }
        
        if (i < methods.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    
    throw new Error('All download methods failed. YouTube is blocking downloads from cloud servers.');
}

// Clean up partial download files
function cleanupPartialFiles(basePath) {
    try {
        const files = fs.readdirSync(downloadsDir);
        files.forEach(file => {
            if (file.includes(path.basename(basePath)) && (file.endsWith('.part') || file.endsWith('.ytdl'))) {
                const filePath = path.join(downloadsDir, file);
                fs.unlinkSync(filePath);
                console.log(`🧹 Cleaned up partial file: ${file}`);
            }
        });
    } catch (error) {
        console.error('Error cleaning partial files:', error);
    }
}

// Find downloaded file
function findDownloadedFile(baseName) {
    try {
        const files = fs.readdirSync(downloadsDir);
        const file = files.find(f => 
            f.includes(baseName) && 
            !f.endsWith('.part') && 
            !f.endsWith('.ytdl') &&
            fs.statSync(path.join(downloadsDir, f)).size > 0
        );
        return file;
    } catch (error) {
        console.error('Error finding downloaded file:', error);
        return null;
    }
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
        
        const info = {
            id: videoInfo.id,
            title: videoInfo.title || 'Unknown Title',
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
        
        console.log(`✅ Successfully fetched info for: ${info.title}`);
        
        res.json({
            success: true,
            data: info
        });
        
    } catch (error) {
        console.error('❌ Error fetching video info:', error.message);
        
        res.status(500).json({
            success: false,
            error: 'YouTube is blocking requests from cloud servers. For reliable access, run this API locally on your computer.',
            solution: 'Download the project and run: npm install && npm start'
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
        
        let videoInfo;
        try {
            videoInfo = await getVideoInfo(url);
        } catch (infoError) {
            console.log('⚠️  Could not get video info, using fallback title');
            videoInfo = { title: 'video' };
        }
        
        const cleanTitle = cleanFilename(videoInfo.title || 'video');
        const filename = `${cleanTitle}.mp4`;
        const baseName = `${Date.now()}_${cleanTitle}`;
        tempFilePath = path.join(downloadsDir, baseName);
        
        await downloadMedia(url, {
            output: tempFilePath,
            args: [
                '-f', 'best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',
                '--merge-output-format', 'mp4'
            ]
        });
        
        const downloadedFile = findDownloadedFile(baseName);
        if (!downloadedFile) {
            throw new Error('Download completed but file not found');
        }
        
        const actualFilePath = path.join(downloadsDir, downloadedFile);
        
        res.setHeader('Content-Disposition', contentDisposition(filename));
        res.setHeader('Content-Type', 'video/mp4');
        
        const fileStream = fs.createReadStream(actualFilePath);
        fileStream.pipe(res);
        
        fileStream.on('end', () => {
            try {
                if (fs.existsSync(actualFilePath)) {
                    fs.unlinkSync(actualFilePath);
                    console.log(`🧹 Cleaned up: ${downloadedFile}`);
                }
            } catch (cleanupError) {
                console.error('Error cleaning up temp file:', cleanupError);
            }
        });
        
        fileStream.on('error', (error) => {
            console.error('File stream error:', error);
            try {
                if (fs.existsSync(actualFilePath)) {
                    fs.unlinkSync(actualFilePath);
                }
            } catch (cleanupError) {
                console.error('Error cleaning up on stream error:', cleanupError);
            }
        });
        
    } catch (error) {
        console.error('❌ Error downloading video:', error.message);
        
        if (tempFilePath) {
            cleanupPartialFiles(tempFilePath);
        }
        
        res.status(500).json({
            success: false,
            error: 'YouTube is blocking downloads from cloud servers. For reliable downloads, run this API locally on your computer.',
            solution: 'Download the project and run: npm install && npm start'
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
        
        let videoInfo;
        try {
            videoInfo = await getVideoInfo(url);
        } catch (infoError) {
            console.log('⚠️  Could not get video info, using fallback title');
            videoInfo = { title: 'audio' };
        }
        
        const cleanTitle = cleanFilename(videoInfo.title || 'audio');
        const filename = `${cleanTitle}.mp3`;
        const baseName = `${Date.now()}_${cleanTitle}`;
        tempFilePath = path.join(downloadsDir, baseName);
        
        try {
            await downloadMedia(url, {
                output: tempFilePath,
                args: [
                    '-f', 'bestaudio',
                    '--extract-audio',
                    '--audio-format', 'mp3',
                    '--audio-quality', '0'
                ]
            });
        } catch (mp3Error) {
            console.log('🔄 MP3 conversion failed, trying m4a format...');
            await downloadMedia(url, {
                output: tempFilePath,
                args: [
                    '-f', 'bestaudio[ext=m4a]/bestaudio',
                    '--extract-audio',
                    '--audio-format', 'm4a'
                ]
            });
        }
        
        const downloadedFile = findDownloadedFile(baseName);
        if (!downloadedFile) {
            throw new Error('Download completed but file not found');
        }
        
        const actualFilePath = path.join(downloadsDir, downloadedFile);
        const fileExtension = path.extname(downloadedFile).toLowerCase();
        
        let contentType = 'audio/mpeg';
        let finalFilename = filename;
        
        if (fileExtension === '.m4a') {
            contentType = 'audio/mp4';
            finalFilename = finalFilename.replace('.mp3', '.m4a');
        } else if (fileExtension === '.webm') {
            contentType = 'audio/webm';
            finalFilename = finalFilename.replace('.mp3', '.webm');
        }
        
        res.setHeader('Content-Disposition', contentDisposition(finalFilename));
        res.setHeader('Content-Type', contentType);
        
        const fileStream = fs.createReadStream(actualFilePath);
        fileStream.pipe(res);
        
        fileStream.on('end', () => {
            try {
                if (fs.existsSync(actualFilePath)) {
                    fs.unlinkSync(actualFilePath);
                    console.log(`🧹 Cleaned up: ${downloadedFile}`);
                }
            } catch (cleanupError) {
                console.error('Error cleaning up temp file:', cleanupError);
            }
        });
        
        fileStream.on('error', (error) => {
            console.error('File stream error:', error);
            try {
                if (fs.existsSync(actualFilePath)) {
                    fs.unlinkSync(actualFilePath);
                }
            } catch (cleanupError) {
                console.error('Error cleaning up on stream error:', cleanupError);
            }
        });
        
    } catch (error) {
        console.error('❌ Error downloading audio:', error.message);
        
        if (tempFilePath) {
            cleanupPartialFiles(tempFilePath);
        }
        
        res.status(500).json({
            success: false,
            error: 'YouTube is blocking downloads from cloud servers. For reliable downloads, run this API locally on your computer.',
            solution: 'Download the project and run: npm install && npm start'
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
        dependencies: dependencies,
        note: '⚠️  Cloud deployments often get blocked by YouTube. Local deployment is recommended for reliable access.'
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'YT-DLP API Server is running!',
        warning: 'YouTube frequently blocks cloud deployments. For reliable usage, run this locally.',
        endpoints: {
            video_info: 'GET /v-i?url=YOUTUBE_URL',
            video_download: 'GET /v-dl?url=YOUTUBE_URL',
            audio_download: 'GET /a-dl?url=YOUTUBE_URL',
            health_check: 'GET /health'
        },
        local_usage: 'For best results: git clone <repo> && npm install && npm start'
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
    console.log(`🔧 Using yt-dlp_linux binary`);
    console.log(`⚠️  IMPORTANT: Cloud deployments often get blocked by YouTube.`);
    console.log(`💡 For reliable usage, run this API locally on your computer.`);
    
    await checkDependencies();
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
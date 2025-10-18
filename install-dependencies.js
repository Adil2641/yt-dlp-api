const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { promisify } = require('util');

async function installDependencies() {
    console.log('🔧 Installing dependencies for platform:', process.platform);
    
    const isWindows = process.platform === 'win32';
    const isRender = process.env.RENDER === 'true';
    
    try {
        // Install yt-dlp
        console.log('📥 Installing yt-dlp...');
        if (isWindows) {
            // Windows - download exe
            await downloadFile(
                'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
                'yt-dlp.exe'
            );
        } else {
            // Linux (Render) - download binary
            await downloadFile(
                'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
                'yt-dlp'
            );
            // Make executable
            fs.chmodSync('yt-dlp', 0o755);
        }
        
        // Install FFmpeg
        console.log('🎵 Installing FFmpeg...');
        if (isWindows) {
            // Windows - download from gyan.dev
            await downloadFile(
                'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
                'ffmpeg.zip'
            );
            
            // Extract (you might need to install unzip tool on Render)
            const { extract } = require('zip-lib');
            await extract('ffmpeg.zip', 'ffmpeg');
            console.log('✅ FFmpeg extracted');
            
        } else {
            // Linux (Render) - download static build
            await downloadFile(
                'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
                'ffmpeg.tar.xz'
            );
            
            // Extract
            execSync('tar -xf ffmpeg.tar.xz');
            const dirs = fs.readdirSync('.').filter(f => f.startsWith('ffmpeg-') && f.endsWith('-static'));
            if (dirs.length > 0) {
                fs.renameSync(dirs[0], 'ffmpeg');
            }
            console.log('✅ FFmpeg extracted');
        }
        
        console.log('✅ All dependencies installed successfully!');
        
    } catch (error) {
        console.error('❌ Failed to install dependencies:', error);
        console.log('💡 You can manually download the binaries:');
        console.log('   yt-dlp: https://github.com/yt-dlp/yt-dlp');
        console.log('   FFmpeg: https://ffmpeg.org/download.html');
        process.exit(1);
    }
}

function downloadFile(url, filename) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filename);
        https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                // Follow redirect
                downloadFile(response.headers.location, filename).then(resolve).catch(reject);
                return;
            }
            
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`✅ Downloaded ${filename}`);
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(filename, () => {});
            reject(err);
        });
    });
}

// Run installation
installDependencies();
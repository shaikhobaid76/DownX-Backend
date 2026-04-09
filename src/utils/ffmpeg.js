const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');

/**
 * Merge video and audio files into one MP4 using ffmpeg.
 * @param {string} videoPath - Path to video file (must have video stream)
 * @param {string} audioPath - Path to audio file (must have audio stream)
 * @param {string} outputPath - Path where merged file will be saved
 * @returns {Promise} Resolves when merging is complete
 */
function mergeVideoAudio(videoPath, audioPath, outputPath) {
  return new Promise((resolve, reject) => {
    // Ensure output directory exists
    fs.ensureDirSync(outputPath.substring(0, outputPath.lastIndexOf('/')));

    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        '-c:v copy',          // copy video stream without re-encoding
        '-c:a aac',           // encode audio to AAC
        '-b:a 192k',          // audio bitrate
        '-movflags +faststart' // optimize for streaming
      ])
      .on('end', () => {
        console.log(`Merged successfully: ${outputPath}`);
        resolve();
      })
      .on('error', (err) => {
        console.error('ffmpeg merge error:', err);
        reject(err);
      })
      .save(outputPath);
  });
}

module.exports = {
  mergeVideoAudio
};
const fs = require('fs');
const path = require('path');
const https = require('https');

const modelId = 'Xenova/distil-small.en';
const textFiles = [
    'config.json',
    'generation_config.json',
    'preprocessor_config.json',
    'tokenizer.json',
    'tokenizer_config.json'
];
// Newer Xenova models often put onnx files in versioned folders or root. 
// Standard structure: model_quantized.onnx is usually in root or subfolder.
// We'll try the standard ONNX filename for this model.
const binaryFiles = [
    'model_quantized.onnx',
    'encoder_model_quantized.onnx',
    'decoder_model_merged_quantized.onnx'
];

const baseUrl = `https://huggingface.co/${modelId}/resolve/main`;
const outputDir = path.join(__dirname, 'public/models/distil-whisper/distil-small.en');

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

const downloadFile = (filename) => {
    const fileUrl = `${baseUrl}/${filename}`;
    const outputPath = path.join(outputDir, filename);
    const file = fs.createWriteStream(outputPath);

    console.log(`Downloading ${filename}...`);

    https.get(fileUrl, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
            // Follow redirect
            https.get(response.headers.location, (redirectResponse) => {
                if (redirectResponse.statusCode !== 200) {
                    console.error(`Failed to download ${filename}: ${redirectResponse.statusCode}`);
                    fs.unlink(outputPath, () => { }); // Delete empty file
                    return;
                }
                redirectResponse.pipe(file);
                file.on('finish', () => {
                    file.close();
                    console.log(`Saved ${filename}`);
                });
            });
        } else if (response.statusCode === 200) {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`Saved ${filename}`);
            });
        } else {
            console.error(`Failed to download ${filename}: ${response.statusCode}`);
            fs.unlink(outputPath, () => { });
        }
    }).on('error', (err) => {
        fs.unlink(outputPath, () => { });
        console.error(`Error downloading ${filename}: ${err.message}`);
    });
};

console.log(`Starting download to ${outputDir}...`);
[...textFiles, ...binaryFiles].forEach(downloadFile);

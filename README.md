<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/165Cs1nOWf2nt9NNlq6Z_vPhkxhVxEoBQ

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Model Setup (Required / Offline Mode)

This project uses a **local** version of the Whisper model (`Xenova/whisper-tiny.en`) to ensure offline capability and speed. You **must** download the model files manually into the `public/models/` directory before running the app, as they are not checked into version control.

### Instructions:

1.  Create the directory:
    ```bash
    mkdir -p public/models/Xenova/whisper-tiny.en/
    ```

2.  Download the following critical files into that folder:
    *   `encoder_model_quantized.onnx` (~10MB)
    *   `decoder_model_merged_quantized.onnx` (~30MB)
    *   `config.json`
    *   `tokenizer.json`
    *   `preprocessor_config.json`
    *   `generation_config.json`

    **Quick Download Command (Bash/Git Bash):**
    ```bash
    cd public/models/Xenova/whisper-tiny.en/
    curl -L -O "https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/onnx/encoder_model_quantized.onnx?download=true"
    curl -L -O "https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/onnx/decoder_model_merged_quantized.onnx?download=true"
    curl -L -O "https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json"
    curl -L -O "https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/tokenizer.json"
    curl -L -O "https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/preprocessor_config.json"
    curl -L -O "https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/generation_config.json"
    ```

**Note:** If the app returns "No speech detected" immediately, ensure your `onnx` files are ~10MB and ~30MB respectively. If they are 1KB text files, you downloaded Git LFS pointers by mistake (re-run the curl commands above).

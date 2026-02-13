// Worker code as a string to avoid file serving issues in this environment
// We use a function to generate the worker code so we can dynamically inject library URL
const createWorkerCode = (libUrl: string) => `
import { pipeline, env } from '${libUrl}';

// Configure to use local models
env.allowLocalModels = true;
env.allowRemoteModels = false;

// WebGPU settings
env.backends.onnx.wasm.numThreads = 1;

let transcriber = null;

self.onmessage = async (e) => {
  const { type, audio } = e.data;
  console.log('[Whisper Worker] Received message:', type, audio ? 'audio length: ' + audio.length : '');

  try {
    if (type === 'load') {
      console.log('[Whisper Worker] Loading Whisper model...');

      if (e.data.modelBaseUrl) {
         env.localModelPath = e.data.modelBaseUrl;
         console.log('[Whisper Worker] Set localModelPath to:', env.localModelPath);
      }

      // Verify WebGPU support and request high-performance GPU (NVIDIA)
      let gpuAdapter = null;
      if (!navigator.gpu) {
        console.warn('[Whisper Worker] WebGPU is NOT available!');
      } else {
        // Request high-performance adapter (NVIDIA) instead of default (Intel)
        gpuAdapter = await navigator.gpu.requestAdapter({
          powerPreference: 'high-performance'
        });
        console.log('[Whisper Worker] WebGPU Adapter:', gpuAdapter?.info);
        console.log('[Whisper Worker] Requested power preference: high-performance');
      }

      if (!transcriber) {
        transcriber = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-small.en', {
          device: 'webgpu',
          dtype: 'fp32',
          progress_callback: (data) => {
            self.postMessage({ type: 'progress', data });
          }
        });
      }
      
      // Final confirmation of GPU being used
      console.log('[Whisper Worker] ✅ Model loaded successfully with WebGPU');
      if (gpuAdapter?.info) {
        console.log(\`[Whisper Worker] 🎮 Using GPU: \${gpuAdapter.info.vendor} \${gpuAdapter.info.architecture || gpuAdapter.info.device || ''}\`);
      }
      self.postMessage({ type: 'ready' });
    } else if (type === 'transcribe') {
      if (!transcriber) {
        throw new Error("Transcriber not initialized");
      }
      
      console.log('[Whisper Worker] Starting transcription, audio samples:', audio.length);
      
      // Optimized transcription settings
      const output = await transcriber(new Float32Array(audio), {
        chunk_length_s: 20,       // Reduced from 30 for faster per-chunk processing
        stride_length_s: 8,       // Increased from 5 to reduce overlap computation
        return_timestamps: false, // Skip timestamp calculation for speed
      });
      
      console.log('[Whisper Worker] Raw output:', JSON.stringify(output));
      
      const text = Array.isArray(output) ? output[0].text : output.text;
      
      console.log('[Whisper Worker] Extracted text:', text);
      self.postMessage({ type: 'result', text });
    }
  } catch (err) {
    console.error('[Whisper Worker] Error:', err);
    self.postMessage({ type: 'error', error: err.message });
  }
};
`;

let worker: Worker | null = null;
let onProgressCallback: ((data: any) => void) | null = null;

export const initWhisper = (onProgress?: (data: any) => void): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (worker) {
      resolve();
      return;
    }

    if (onProgress) {
      onProgressCallback = onProgress;
    }

    // Calculate absolute path to models directory
    const modelBaseUrl = new URL('models/', window.location.href).href;
    console.log('[Whisper] Using local model path:', modelBaseUrl);

    // Use local transformers.js v3.1.2
    const libUrl = new URL('libs/transformers/3.1.2/transformers.min.js', window.location.href).href;
    console.log('[Whisper] Using local lib path:', libUrl);

    const workerCode = createWorkerCode(libUrl);
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    worker = new Worker(URL.createObjectURL(blob), { type: 'module' });

    worker.onmessage = (e) => {
      if (e.data.type !== 'progress') {
        console.log('[Whisper] Worker message:', e.data);
      }
      const { type, data, error } = e.data;
      if (type === 'ready') {
        console.log('[Whisper] Model ready');
        resolve();
      } else if (type === 'progress') {
        if (onProgressCallback) onProgressCallback(data);
      } else if (type === 'error') {
        console.error('[Whisper] Worker error:', error);
        reject(new Error(error));
      }
    };

    worker.onerror = (e) => {
      reject(new Error("Worker script failed to load. Check your connection or Content Security Policy."));
    };

    worker.postMessage({ type: 'load', modelBaseUrl });
  });
};

export const transcribeWithWhisper = async (audioBlob: Blob): Promise<string> => {
  console.log('[Whisper] transcribeWithWhisper called', {
    blobSize: audioBlob.size,
    blobType: audioBlob.type
  });

  if (!worker) {
    throw new Error("Whisper model not initialized. Call initWhisper() first.");
  }

  // Resample audio to 16kHz (required by Whisper)
  const audioData = await decodeAndResample(audioBlob);

  // Calculate max amplitude for debugging
  let maxAmp = 0;
  for (let i = 0; i < audioData.length; i++) {
    const absVal = Math.abs(audioData[i]);
    if (absVal > maxAmp) maxAmp = absVal;
  }
  console.log('[Whisper] Audio resampled', {
    samples: audioData.length,
    durationSec: (audioData.length / 16000).toFixed(2),
    maxAmplitude: maxAmp.toFixed(4)
  });

  return new Promise((resolve, reject) => {
    if (!worker) return reject("Worker not initialized");

    console.log('[Whisper] Sending audio to worker...');

    const handleMessage = (e: MessageEvent) => {
      console.log('[Whisper] Transcribe response:', e.data);
      const { type, text, error } = e.data;
      if (type === 'result') {
        worker!.removeEventListener('message', handleMessage);
        console.log('[Whisper] Transcription result:', text);
        resolve(text);
      } else if (type === 'error') {
        worker!.removeEventListener('message', handleMessage);
        console.error('[Whisper] Transcription error:', error);
        reject(new Error(error));
      }
    };

    worker.addEventListener('message', handleMessage);
    worker.postMessage({ type: 'transcribe', audio: audioData });
  });
};

// Robust audio decoder and resampler using OfflineAudioContext
async function decodeAndResample(audioBlob: Blob): Promise<Float32Array> {
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    console.log('[Whisper] ArrayBuffer size:', arrayBuffer.byteLength);

    // 1. Decode the audio
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    console.log('[Whisper] Decoded audio:', {
      duration: audioBuffer.duration.toFixed(2) + 's',
      originalSampleRate: audioBuffer.sampleRate,
      channels: audioBuffer.numberOfChannels
    });

    // 2. Resample to 16kHz using OfflineAudioContext
    // This uses the browser's native high-quality resampling
    const targetSampleRate = 16000;
    const targetLength = Math.ceil(audioBuffer.duration * targetSampleRate);

    // Create offline context at 16kHz, 1 channel (mono)
    const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    console.log('[Whisper] Rendering offline context...');
    const renderedBuffer = await offlineCtx.startRendering();

    console.log('[Whisper] Resampled audio:', {
      samples: renderedBuffer.length,
      duration: renderedBuffer.duration.toFixed(2),
      sampleRate: renderedBuffer.sampleRate
    });

    // 3. Extract channel data and normalize
    const resampledData = renderedBuffer.getChannelData(0);

    return normalizeAudio(resampledData);

  } catch (e) {
    console.error("Audio processing failed", e);
    throw new Error("Failed to process audio data. Please ensure your microphone is working.");
  } finally {
    audioCtx.close();
  }
}

function normalizeAudio(data: Float32Array): Float32Array {
  let max = 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const val = Math.abs(data[i]);
    if (val > max) max = val;
    sum += val;
  }

  const avg = sum / data.length;
  console.log(`[Whisper] Audio Stats - Max Amp: ${max.toFixed(5)}, Avg Amp: ${avg.toFixed(5)}, Samples: ${data.length}`);

  // Prevent division by zero or amplifying noise too much if silence
  if (max < 0.001) {
    console.warn("Audio appears silent (max amplitude < 0.001)");
    return data;
  }

  // Amplification factor. Target peak of 0.95.
  const target = 0.95;
  const scaler = target / max;

  console.log(`[Whisper] Normalizing audio with scalar ${scaler.toFixed(2)}`);

  const newData = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    newData[i] = data[i] * scaler;
  }

  return newData;
}
// Worker code as a string to avoid file serving issues in this environment
const WORKER_CODE = `
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';

// Disable local models to force download from HuggingFace Hub
env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriber = null;

self.onmessage = async (e) => {
  const { type, audio } = e.data;

  try {
    if (type === 'load') {
      if (!transcriber) {
        // Using quantized whisper-tiny.en for speed and reasonable accuracy (~40MB)
        transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
          progress_callback: (data) => {
            self.postMessage({ type: 'progress', data });
          }
        });
      }
      self.postMessage({ type: 'ready' });
    } else if (type === 'transcribe') {
      if (!transcriber) {
        throw new Error("Transcriber not initialized");
      }
      
      // Run transcription
      const output = await transcriber(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        language: 'english',
        task: 'transcribe',
      });
      
      // Output structure differs slightly based on version/task, usually it's { text: "..." } or [{ text: "..." }]
      const text = Array.isArray(output) ? output[0].text : output.text;
      
      self.postMessage({ type: 'result', text });
    }
  } catch (err) {
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

    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    worker = new Worker(URL.createObjectURL(blob), { type: 'module' });

    worker.onmessage = (e) => {
      const { type, data, error } = e.data;
      if (type === 'ready') {
        resolve();
      } else if (type === 'progress') {
        if (onProgressCallback) onProgressCallback(data);
      } else if (type === 'error') {
        reject(new Error(error));
      }
    };

    worker.onerror = (e) => {
      reject(new Error("Worker script failed to load. Check your connection or Content Security Policy."));
    };

    worker.postMessage({ type: 'load' });
  });
};

export const transcribeWithWhisper = async (audioBlob: Blob): Promise<string> => {
  if (!worker) {
    throw new Error("Whisper model not initialized. Call initWhisper() first.");
  }

  // Resample audio to 16kHz (required by Whisper)
  const audioData = await decodeAndResample(audioBlob);

  return new Promise((resolve, reject) => {
    if (!worker) return reject("Worker not initialized");

    const handleMessage = (e: MessageEvent) => {
      const { type, text, error } = e.data;
      if (type === 'result') {
        worker!.removeEventListener('message', handleMessage);
        resolve(text);
      } else if (type === 'error') {
        worker!.removeEventListener('message', handleMessage);
        reject(new Error(error));
      }
    };

    worker.addEventListener('message', handleMessage);
    worker.postMessage({ type: 'transcribe', audio: audioData });
  });
};

// Robust audio decoder and resampler
async function decodeAndResample(audioBlob: Blob): Promise<Float32Array> {
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    
    // 1. Convert to Mono (Average channels if stereo)
    let sourceData = audioBuffer.getChannelData(0);
    
    if (audioBuffer.numberOfChannels > 1) {
      const ch2 = audioBuffer.getChannelData(1);
      const mono = new Float32Array(sourceData.length);
      for (let i = 0; i < sourceData.length; i++) {
        mono[i] = (sourceData[i] + ch2[i]) / 2;
      }
      sourceData = mono;
    }

    // 2. Resample to 16kHz if necessary
    const targetSampleRate = 16000;
    let resampledData: Float32Array;

    if (audioBuffer.sampleRate === targetSampleRate) {
      resampledData = sourceData;
    } else {
      // Manual Linear Interpolation Resampling (Safer than OfflineAudioContext)
      const ratio = audioBuffer.sampleRate / targetSampleRate;
      const newLength = Math.round(sourceData.length / ratio);
      resampledData = new Float32Array(newLength);
      
      for (let i = 0; i < newLength; i++) {
        const position = i * ratio;
        const index = Math.floor(position);
        const fraction = position - index;
        
        if (index >= sourceData.length - 1) {
          resampledData[i] = sourceData[sourceData.length - 1];
        } else {
          resampledData[i] = sourceData[index] * (1 - fraction) + sourceData[index + 1] * fraction;
        }
      }
    }

    // 3. Normalize Audio
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
  for (let i = 0; i < data.length; i++) {
    const val = Math.abs(data[i]);
    if (val > max) max = val;
  }

  // Prevent division by zero or amplifying noise too much if silence
  if (max < 0.001) {
    console.warn("Audio appears silent (max amplitude < 0.001)");
    return data; 
  }

  // Amplification factor. Target peak of 0.95.
  const target = 0.95;
  const scaler = target / max;

  const newData = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    newData[i] = data[i] * scaler;
  }
  
  return newData;
}
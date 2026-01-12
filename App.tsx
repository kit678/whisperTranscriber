import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Mic,
  Square,
  History,
  Settings,
  Wand2,
  Copy,
  Check,
  Trash2,
  Languages,
  Keyboard,
  Cpu,
  MoreHorizontal,
  Download,
  FileText,
  List,
  Mail,
  Code,
  Loader2,
  RefreshCw,
  Mic2
} from 'lucide-react';
import { AppView, AiMode, DictationSession, UserSettings } from './types';
import { AI_MODES_CONFIG, INITIAL_SETTINGS } from './constants';
import { refineText } from './services/geminiService';
import { initWhisper, transcribeWithWhisper } from './services/whisperService';
import AudioVisualizer from './components/AudioVisualizer';
import Tooltip from './components/Tooltip';

function App() {
  const [view, setView] = useState<AppView>(AppView.RECORDER);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState<string>(""); // For granular status
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [currentText, setCurrentText] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Audio Devices
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);

  // Whisper State
  const [isModelReady, setIsModelReady] = useState(false);
  const [modelProgress, setModelProgress] = useState<{ status: string; progress: number } | null>(null);

  const [settings, setSettings] = useState<UserSettings>(INITIAL_SETTINGS);
  const [activeMode, setActiveMode] = useState<AiMode>(settings.defaultMode);

  // History State
  const [history, setHistory] = useState<DictationSession[]>([]);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const mimeTypeRef = useRef<string>("");

  // Load history on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem('whisper_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
    loadModel();
    getAudioDevices();

    // Listen for device changes (plugging in new mic)
    navigator.mediaDevices.addEventListener('devicechange', getAudioDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getAudioDevices);
    };
  }, []);

  const getAudioDevices = async () => {
    try {
      // We might need to ask for permission first to see labels, but enumerateDevices works without it (labels might be empty)
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      setInputDevices(audioInputs);
    } catch (err) {
      console.error("Error enumerating devices:", err);
    }
  };

  const getSupportedMimeType = () => {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
      'audio/wav'
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return ''; // Default fallback
  };

  const loadModel = async () => {
    setErrorMsg(null);
    setIsModelReady(false);
    try {
      await initWhisper((data) => {
        if (data.status === 'progress' || data.status === 'initiate') {
          // Simplified progress tracking
          const percent = data.progress ? Math.round(data.progress) : 0;
          setModelProgress({ status: data.file, progress: percent });
        }
      });
      setIsModelReady(true);
      setModelProgress(null);
    } catch (err: any) {
      console.error("Failed to load Whisper model", err);
      setErrorMsg("Failed to load Whisper model: " + (err.message || "Unknown error"));
    }
  };

  // Save history on change
  useEffect(() => {
    localStorage.setItem('whisper_history', JSON.stringify(history));
  }, [history]);

  const startRecording = async () => {
    if (!isModelReady) return;
    try {
      // Use selected microphone if available
      const constraints: MediaStreamConstraints = {
        audio: settings.selectedMicrophoneId
          ? { deviceId: { exact: settings.selectedMicrophoneId } }
          : true
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setAudioStream(stream);

      // Refresh device list now that we have permissions (labels will appear)
      getAudioDevices();

      // Determine optimal mime type
      const mimeType = getSupportedMimeType();
      mimeTypeRef.current = mimeType;

      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      startTimeRef.current = Date.now();

      mediaRecorder.ondataavailable = (event) => {
        console.log(`[App] Data available: ${event.data.size} bytes`);
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = handleStopRecording;

      mediaRecorder.start();
      setIsRecording(true);
      setErrorMsg(null);
      setCurrentText("");
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setErrorMsg("Could not access microphone. Please check permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      // Stop streams
      if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        setAudioStream(null);
      }
    }
  };

  const handleStopRecording = async () => {
    setIsProcessing(true);
    setProcessingStage("Transcribing audio...");
    try {
      // Create blob using the same mime type we started with
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeTypeRef.current || 'audio/webm' });
      console.log(`[App] Recording stopped. Total Blob size: ${audioBlob.size} bytes, Type: ${audioBlob.type}`);

      // 1. Transcribe with Local Whisper
      let transcribedText = await transcribeWithWhisper(audioBlob);

      if (!transcribedText || !transcribedText.trim()) {
        // More descriptive error if still failing, but normalization should fix this.
        throw new Error("No speech detected. Ensure microphone volume is up.");
      }

      // 2. Refine with Gemini (if mode is not Verbatim)
      if (activeMode !== AiMode.VERBATIM) {
        setProcessingStage(`Applying ${activeMode} mode...`);
        try {
          const modeConfig = AI_MODES_CONFIG[activeMode];
          transcribedText = await refineText(transcribedText, modeConfig.prompt);
        } catch (refineError) {
          console.warn("Refinement failed, falling back to verbatim", refineError);
          // Fallback to verbatim is automatic since transcribedText holds the whisper output
        }
      }

      setCurrentText(transcribedText);

      // Save to history
      const newSession: DictationSession = {
        id: crypto.randomUUID(),
        originalText: transcribedText,
        processedText: transcribedText,
        createdAt: Date.now(),
        duration: (Date.now() - startTimeRef.current) / 1000,
        mode: activeMode
      };

      setHistory(prev => [newSession, ...prev]);

      if (settings.autoCopy) {
        copyToClipboard(transcribedText);
      }

    } catch (err: any) {
      setErrorMsg(err.message || "Failed to process audio.");
    } finally {
      setIsProcessing(false);
      setProcessingStage("");
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error("Failed to copy", err);
    }
  };

  const getModeIcon = (mode: AiMode) => {
    const iconName = AI_MODES_CONFIG[mode].icon;
    switch (iconName) {
      case 'Mic': return <Mic className="w-5 h-5" />;
      case 'Wand2': return <Wand2 className="w-5 h-5" />;
      case 'FileText': return <FileText className="w-5 h-5" />;
      case 'List': return <List className="w-5 h-5" />;
      case 'Mail': return <Mail className="w-5 h-5" />;
      case 'Code': return <Code className="w-5 h-5" />;
      default: return <Mic className="w-5 h-5" />;
    }
  };

  // Render components
  const renderSidebar = () => (
    <div className="w-16 md:w-20 bg-surface border-r border-white/5 flex flex-col items-center py-6 gap-6 z-20">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mb-4 shadow-lg shadow-purple-900/20">
        <Mic className="w-6 h-6 text-white" />
      </div>

      <nav className="flex flex-col gap-4 w-full px-2">
        <SidebarBtn
          icon={<Mic />}
          isActive={view === AppView.RECORDER}
          onClick={() => setView(AppView.RECORDER)}
          label="Record"
        />
        <SidebarBtn
          icon={<History />}
          isActive={view === AppView.HISTORY}
          onClick={() => setView(AppView.HISTORY)}
          label="History"
        />
        <SidebarBtn
          icon={<Settings />}
          isActive={view === AppView.SETTINGS}
          onClick={() => setView(AppView.SETTINGS)}
          label="Settings"
        />
      </nav>

      <div className="mt-auto">
        <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-500">
          V1
        </div>
      </div>
    </div>
  );

  const renderRecorder = () => (
    <div className="flex-1 flex flex-col items-center justify-center p-6 relative max-w-4xl mx-auto w-full">
      {/* Mode Selector */}
      <div className="absolute top-6 right-6 md:right-10 z-10">
        <div className="bg-surfaceHighlight rounded-lg p-1 flex gap-1 border border-white/5 shadow-xl">
          {Object.values(AiMode).map((mode) => (
            <Tooltip key={mode} text={AI_MODES_CONFIG[mode].description}>
              <button
                onClick={() => setActiveMode(mode)}
                className={`p-2 rounded-md transition-all ${activeMode === mode
                  ? 'bg-zinc-700 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                  }`}
              >
                {getModeIcon(mode)}
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      <div className="flex-1 w-full flex flex-col items-center justify-center gap-8 min-h-[400px]">
        {/* Main Status / Visualizer */}
        <div className="w-full h-32 flex items-center justify-center">
          {isRecording ? (
            <AudioVisualizer stream={audioStream} isRecording={isRecording} />
          ) : isProcessing ? (
            <div className="flex flex-col items-center gap-4 animate-pulse">
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
                <Wand2 className="w-8 h-8 text-primary animate-spin-slow" />
              </div>
              <p className="text-zinc-400 font-medium">{processingStage || "Processing..."}</p>
            </div>
          ) : !isModelReady ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <div className="text-center">
                <p className="text-zinc-300 font-medium">Loading Whisper Model...</p>
                {modelProgress && (
                  <p className="text-xs text-zinc-500 mt-1">
                    {modelProgress.status}: {modelProgress.progress}%
                  </p>
                )}
              </div>
              {errorMsg && (
                <button
                  onClick={loadModel}
                  className="mt-2 flex items-center gap-2 px-3 py-1.5 bg-red-500/10 text-red-400 rounded-lg text-sm hover:bg-red-500/20 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" /> Retry
                </button>
              )}
            </div>
          ) : currentText ? (
            <div className="text-center space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 text-sm font-medium">
                <Check className="w-4 h-4" /> Success
              </div>
            </div>
          ) : (
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-white tracking-tight">Tap to Speak</h2>
              <p className="text-zinc-500">Mode: <span className="text-primary">{activeMode}</span></p>
              {settings.selectedMicrophoneId && inputDevices.find(d => d.deviceId === settings.selectedMicrophoneId) && (
                <p className="text-xs text-zinc-600 flex items-center justify-center gap-1 mt-1">
                  <Mic2 className="w-3 h-3" />
                  {inputDevices.find(d => d.deviceId === settings.selectedMicrophoneId)?.label || "Selected Microphone"}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Action Button */}
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={!isModelReady || isProcessing}
          className={`
            relative group w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300
            ${isRecording
              ? 'bg-red-500 hover:bg-red-600 shadow-[0_0_40px_rgba(239,68,68,0.4)]'
              : (!isModelReady || isProcessing)
                ? 'bg-zinc-800 cursor-not-allowed opacity-50'
                : 'bg-primary hover:bg-primaryHover shadow-[0_0_40px_rgba(139,92,246,0.3)] hover:shadow-[0_0_60px_rgba(139,92,246,0.5)] hover:scale-105'
            }
          `}
        >
          {isRecording ? (
            <Square className="w-8 h-8 text-white fill-current" />
          ) : (
            <Mic className={`w-8 h-8 text-white ${isProcessing ? 'opacity-50' : ''}`} />
          )}

          {/* Ring animation when recording */}
          {isRecording && (
            <span className="absolute inset-0 rounded-full border-2 border-red-500 animate-ping opacity-75"></span>
          )}
        </button>

        {/* Text Output Area - Always Visible */}
        <div className="w-full max-w-2xl bg-surface border border-white/5 rounded-2xl p-6 shadow-2xl transition-all duration-500">
          <textarea
            readOnly
            value={currentText}
            placeholder={isProcessing ? processingStage : "Your transcribed text will appear here..."}
            className="w-full bg-transparent text-lg text-zinc-100 placeholder-zinc-600 focus:outline-none resize-none min-h-[150px] leading-relaxed"
          />
          {/* Actions bar, dimmed if no text */}
          <div className={`flex justify-between items-center mt-4 pt-4 border-t border-white/5 transition-opacity ${currentText ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <div className="text-xs text-zinc-500 font-mono">
              {currentText.split(' ').filter(Boolean).length} words
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setCurrentText("");
                }}
                className="p-2 hover:bg-white/5 rounded-lg text-zinc-400 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => copyToClipboard(currentText)}
                className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-colors"
              >
                <Copy className="w-4 h-4" /> Copy Text
              </button>
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="text-red-400 bg-red-400/10 px-4 py-2 rounded-lg text-sm border border-red-400/20">
            {errorMsg}
          </div>
        )}
      </div>
    </div>
  );

  const renderHistory = () => (
    <div className="flex-1 p-8 overflow-y-auto max-w-5xl mx-auto w-full">
      <h2 className="text-3xl font-bold mb-8">History</h2>
      <div className="grid gap-4">
        {history.length === 0 ? (
          <div className="text-center py-20 text-zinc-500 border border-dashed border-zinc-800 rounded-2xl">
            No dictations yet. Start speaking!
          </div>
        ) : (
          history.map(session => (
            <div key={session.id} className="bg-surface border border-white/5 rounded-xl p-5 hover:border-primary/30 transition-colors group">
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-zinc-900 rounded-lg text-primary">
                    {getModeIcon(session.mode)}
                  </div>
                  <div>
                    <div className="text-sm text-zinc-400">
                      {new Date(session.createdAt).toLocaleDateString()} • {new Date(session.createdAt).toLocaleTimeString()}
                    </div>
                    <div className="text-xs text-zinc-600 font-mono mt-0.5">
                      {session.duration.toFixed(1)}s • {session.mode}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => copyToClipboard(session.processedText)}
                  className="p-2 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              <p className="text-zinc-300 line-clamp-3 leading-relaxed">
                {session.processedText}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="flex-1 p-8 overflow-y-auto max-w-3xl mx-auto w-full">
      <h2 className="text-3xl font-bold mb-8">Settings</h2>

      <div className="space-y-6">
        <div className="bg-surface border border-white/5 rounded-xl p-6">
          <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-primary" /> Audio & Model
          </h3>

          <div className="grid gap-4">
            {/* Microphone Selection */}
            <div className="flex items-center justify-between p-4 bg-zinc-900/50 rounded-lg border border-white/5">
              <div>
                <div className="font-medium">Microphone Input</div>
                <div className="text-sm text-zinc-500">Select which device to capture audio from.</div>
              </div>
              <select
                value={settings.selectedMicrophoneId || ""}
                onChange={(e) => setSettings({ ...settings, selectedMicrophoneId: e.target.value })}
                className="bg-zinc-800 border-none rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary outline-none max-w-[200px]"
              >
                <option value="">Default Microphone</option>
                {inputDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between p-4 bg-zinc-900/50 rounded-lg border border-white/5">
              <div>
                <div className="font-medium">Default Mode</div>
                <div className="text-sm text-zinc-500">The AI style applied when you start speaking.</div>
              </div>
              <select
                value={settings.defaultMode}
                onChange={(e) => setSettings({ ...settings, defaultMode: e.target.value as AiMode })}
                className="bg-zinc-800 border-none rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary outline-none"
              >
                {Object.values(AiMode).map(mode => (
                  <option key={mode} value={mode}>{mode}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="bg-surface border border-white/5 rounded-xl p-6">
          <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-accent" /> Workflow
          </h3>
          <div className="space-y-4">
            <label className="flex items-center justify-between p-4 bg-zinc-900/50 rounded-lg border border-white/5 cursor-pointer hover:bg-zinc-900 transition-colors">
              <div>
                <div className="font-medium">Auto-Copy</div>
                <div className="text-sm text-zinc-500">Automatically copy text to clipboard after processing.</div>
              </div>
              <input
                type="checkbox"
                checked={settings.autoCopy}
                onChange={(e) => setSettings({ ...settings, autoCopy: e.target.checked })}
                className="w-5 h-5 accent-primary rounded bg-zinc-700 border-zinc-600"
              />
            </label>

            <div className="flex items-center justify-between p-4 bg-zinc-900/50 rounded-lg border border-white/5 opacity-75 cursor-not-allowed">
              <div>
                <div className="font-medium">Input Language</div>
                <div className="text-sm text-zinc-500">English Only (Whisper Tiny.en)</div>
              </div>
              <div className="flex items-center gap-2 text-zinc-500 text-sm">
                <Languages className="w-4 h-4" /> EN
              </div>
            </div>
          </div>
        </div>

        <div className="text-center pt-8 text-zinc-600 text-sm">
          <p>WhisperType Web Clone • Powered by Local Whisper & Google Gemini</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-background text-zinc-100 font-sans selection:bg-primary/30">
      {renderSidebar()}

      <main className="flex-1 flex overflow-hidden relative">
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none"></div>
        {/* Ambient Glows */}
        <div className="absolute top-0 left-0 w-full h-1/2 bg-primary/5 blur-[120px] pointer-events-none"></div>
        <div className="absolute bottom-0 right-0 w-1/2 h-1/2 bg-accent/5 blur-[120px] pointer-events-none"></div>

        {view === AppView.RECORDER && renderRecorder()}
        {view === AppView.HISTORY && renderHistory()}
        {view === AppView.SETTINGS && renderSettings()}
      </main>
    </div>
  );
}

// Helper Component for Sidebar Buttons
const SidebarBtn = ({ icon, isActive, onClick, label }: { icon: React.ReactNode, isActive: boolean, onClick: () => void, label: string }) => (
  <Tooltip text={label}>
    <button
      onClick={onClick}
      className={`w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center transition-all duration-200 ${isActive
        ? 'bg-zinc-800 text-white shadow-inner'
        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
        }`}
    >
      {React.cloneElement(icon as React.ReactElement, { size: 20 })}
    </button>
  </Tooltip>
);

export default App;
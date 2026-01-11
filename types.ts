export enum AppView {
  RECORDER = 'RECORDER',
  HISTORY = 'HISTORY',
  SETTINGS = 'SETTINGS',
  TEMPLATES = 'TEMPLATES'
}

export enum AiMode {
  VERBATIM = 'Verbatim',
  POLISHED = 'Polished',
  SUMMARIZED = 'Summarized',
  BULLET_POINTS = 'Bullet Points',
  EMAIL_FORMAT = 'Email Format',
  CODE_CLEANUP = 'Code Cleanup'
}

export interface DictationSession {
  id: string;
  originalText: string;
  processedText: string;
  createdAt: number;
  duration: number; // in seconds
  mode: AiMode;
}

export interface UserSettings {
  defaultMode: AiMode;
  autoCopy: boolean;
  language: string;
  openAiKey?: string; // Not used, but typical for this app type
  selectedMicrophoneId?: string;
}

export interface AudioVisualizerProps {
  isRecording: boolean;
  audioData: Uint8Array;
}
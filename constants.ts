import { AiMode } from './types';

export const AI_MODES_CONFIG: Record<AiMode, { icon: string; prompt: string; description: string }> = {
  [AiMode.VERBATIM]: {
    icon: 'Mic',
    prompt: "Transcribe the audio exactly as spoken, preserving all words. Remove filler words like 'um' and 'ah' only if they are excessive.",
    description: "Exact transcription of your speech."
  },
  [AiMode.POLISHED]: {
    icon: 'Wand2',
    prompt: "Transcribe the audio and then polish the text to be professional, clear, and grammatically correct. Remove redundancy.",
    description: "Professional, grammar-perfect text."
  },
  [AiMode.SUMMARIZED]: {
    icon: 'FileText',
    prompt: "Transcribe the audio and provide a concise summary of the key points.",
    description: "Concise summary of thoughts."
  },
  [AiMode.BULLET_POINTS]: {
    icon: 'List',
    prompt: "Transcribe the audio and convert the content into a structured list of bullet points.",
    description: "Structured list format."
  },
  [AiMode.EMAIL_FORMAT]: {
    icon: 'Mail',
    prompt: "Transcribe the audio and format it as a professional email draft.",
    description: "Ready-to-send email draft."
  },
  [AiMode.CODE_CLEANUP]: {
    icon: 'Code',
    prompt: "The audio contains technical discussion or code. Transcribe it and format any code blocks using markdown.",
    description: "Optimized for technical dictation."
  }
};

export const INITIAL_SETTINGS = {
  defaultMode: AiMode.VERBATIM,
  autoCopy: false,
  language: 'en-US',
  selectedMicrophoneId: ''
};
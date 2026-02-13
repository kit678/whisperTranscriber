
export const transcribeWithGroq = async (audioBlob: Blob, apiKey: string): Promise<string> => {
    if (!apiKey) throw new Error("Groq API Key is required for this mode");

    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    formData.append('model', 'whisper-large-v3');

    try {
        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
            },
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `Groq API Error: ${response.status}`);
        }

        const data = await response.json();
        return data.text;
    } catch (error) {
        console.error("Groq Transcription Error:", error);
        throw error;
    }
};

export const polishWithGroq = async (text: string, instruction: string, apiKey: string): Promise<string> => {
    if (!apiKey) throw new Error("Groq API Key is required for polishing");

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful AI assistant that polishes text based on instructions. Output ONLY the polished text, no preamble or quotes."
                    },
                    {
                        role: "user",
                        content: `Original Text: "${text}"\n\nInstruction: ${instruction}`
                    }
                ],
                temperature: 0.2,
                max_completion_tokens: 4096
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `Groq API Error: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || text;
    } catch (error) {
        console.error("Groq Polishing Error:", error);
        throw error;
    }
};

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Modality, LiveServerMessage } from '@google/genai';
import { getLiveClient } from '../services/geminiService';
import { float32ToPCM16, decodeBase64, decodeAudioData, encodeBase64 } from '../services/audioUtils';

interface LiveSessionProps {
  onClose: () => void;
  onCreatePlan: (transcript: string) => void;
}

const THAI_ICONS = ['🐘', '🛕', '🍜', '🛶', '🥭', '🥊', '🏖️'];

const LiveSession: React.FC<LiveSessionProps> = ({ onClose, onCreatePlan }) => {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error' | 'disconnected'>('idle');
  const [volume, setVolume] = useState(0);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [iconIndex, setIconIndex] = useState(0);
  
  // Audio Refs
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const mountedRef = useRef(true);
  
  // Transcription
  const transcriptionRef = useRef<string>("");
  const currentInputTransRef = useRef<string>("");
  const currentOutputTransRef = useRef<string>("");

  // Animation frame for volume visualizer
  const requestRef = useRef<number>(0);

  // Icon animation interval
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isAgentSpeaking) {
        interval = setInterval(() => {
            setIconIndex(prev => (prev + 1) % THAI_ICONS.length);
        }, 600);
    } else {
        setIconIndex(0);
    }
    return () => clearInterval(interval);
  }, [isAgentSpeaking]);

  const cleanup = useCallback(() => {
    mountedRef.current = false;
    
    // Stop sources
    sourcesRef.current.forEach(source => {
        try { source.stop(); } catch(e) {}
    });
    sourcesRef.current.clear();

    // Close contexts
    inputContextRef.current?.close();
    outputContextRef.current?.close();

    // Stop stream
    streamRef.current?.getTracks().forEach(track => track.stop());

    // Close session
    if (sessionPromiseRef.current) {
        sessionPromiseRef.current.then(session => session.close()).catch(() => {});
    }

    if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
      return cleanup;
  }, [cleanup]);

  const startSession = async () => {
    setStatus('connecting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Input Audio Setup (16kHz for input)
      inputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const source = inputContextRef.current.createMediaStreamSource(stream);
      const processor = inputContextRef.current.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      
      source.connect(processor);
      processor.connect(inputContextRef.current.destination);

      // Output Audio Setup (24kHz for output)
      outputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const outputNode = outputContextRef.current.createGain();
      outputNode.connect(outputContextRef.current.destination);

      const liveClient = getLiveClient();

      sessionPromiseRef.current = liveClient.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            if (mountedRef.current) setStatus('connected');
            
            processor.onaudioprocess = (e) => {
              if (!mountedRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              
              // Visualize volume
              let sum = 0;
              for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              setVolume(Math.min(rms * 5, 1)); 

              // Convert to PCM16
              const pcm16 = float32ToPCM16(inputData);
              const base64Data = encodeBase64(pcm16);

              sessionPromiseRef.current?.then(session => {
                session.sendRealtimeInput({
                  media: {
                    mimeType: 'audio/pcm;rate=16000',
                    data: base64Data
                  }
                });
              });
            };
          },
          onmessage: async (message: LiveServerMessage) => {
             if (!mountedRef.current) return;

             // Transcription Handling
             if (message.serverContent?.outputTranscription) {
                currentOutputTransRef.current += message.serverContent.outputTranscription.text;
             }
             if (message.serverContent?.inputTranscription) {
                currentInputTransRef.current += message.serverContent.inputTranscription.text;
             }
             if (message.serverContent?.turnComplete) {
                const userText = currentInputTransRef.current;
                const modelText = currentOutputTransRef.current;
                if (userText) transcriptionRef.current += `User: ${userText}\n`;
                if (modelText) transcriptionRef.current += `Guide: ${modelText}\n`;
                
                currentInputTransRef.current = "";
                currentOutputTransRef.current = "";
             }

             // Handle Audio Output
             const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
             if (base64Audio && outputContextRef.current) {
               const ctx = outputContextRef.current;
               nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
               
               const audioBuffer = await decodeAudioData(
                 decodeBase64(base64Audio),
                 ctx,
                 24000,
                 1
               );
               
               const source = ctx.createBufferSource();
               source.buffer = audioBuffer;
               source.connect(outputNode);
               
               source.onended = () => {
                 sourcesRef.current.delete(source);
                 if (sourcesRef.current.size === 0) {
                   setIsAgentSpeaking(false);
                 }
               };
               
               setIsAgentSpeaking(true);
               source.start(nextStartTimeRef.current);
               nextStartTimeRef.current += audioBuffer.duration;
               sourcesRef.current.add(source);
             }

             // Handle Interruptions
             if (message.serverContent?.interrupted) {
               sourcesRef.current.forEach(src => {
                 try { src.stop(); } catch(e) {}
               });
               sourcesRef.current.clear();
               setIsAgentSpeaking(false);
               nextStartTimeRef.current = 0;
             }
          },
          onclose: () => {
            if (mountedRef.current) setStatus('disconnected');
          },
          onerror: (err) => {
            console.error(err);
            if (mountedRef.current) setStatus('error');
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
          },
          systemInstruction: "You are Somsri, a friendly and energetic Thai local guide. Speak briefly and enthusiastically about Thailand. Encourage the user to plan a trip. Ask them where they want to go.",
        }
      });

    } catch (err) {
      console.error("Failed to initialize live session", err);
      setStatus('error');
    }
  };

  const handleCreatePlan = () => {
     // Capture any remaining partial transcript
     let finalTranscript = transcriptionRef.current;
     if (currentInputTransRef.current) finalTranscript += `User: ${currentInputTransRef.current}\n`;
     if (currentOutputTransRef.current) finalTranscript += `Guide: ${currentOutputTransRef.current}\n`;
     
     onCreatePlan(finalTranscript);
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 bg-gradient-to-br from-indigo-900 to-purple-900 rounded-2xl text-white shadow-2xl w-full max-w-md mx-auto relative overflow-hidden min-h-[500px]">
        {/* Background Decorative Elements */}
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
            <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
                <path fill="#FF0066" d="M44.7,-76.4C58.9,-69.2,71.8,-59.1,81.6,-46.6C91.4,-34.1,98.1,-19.2,95.8,-5.3C93.5,8.6,82.2,21.4,70.6,31.4C59,41.4,47.1,48.6,35.2,55.3C23.3,62,11.4,68.2,-1.3,70.5C-14,72.8,-28.3,71.2,-41.2,65.2C-54.1,59.2,-65.6,48.8,-73.8,36.1C-82,23.4,-86.9,8.4,-85.1,-5.8C-83.3,-20,-74.8,-33.4,-64,-44.6C-53.2,-55.8,-40.1,-64.8,-26.6,-72.5C-13.1,-80.2,0.8,-86.6,14.7,-85.4L28.6,-84.2Z" transform="translate(100 100)" />
            </svg>
        </div>

      <div className="relative z-10 flex flex-col items-center w-full">
        {/* Avatar Section */}
        <div className="relative mb-6">
             <div className={`w-40 h-40 rounded-full overflow-hidden border-4 transition-all duration-300 bg-white ${isAgentSpeaking ? 'border-amber-400 shadow-[0_0_30px_rgba(251,191,36,0.6)] scale-105' : 'border-indigo-400'}`}>
                <img src="/Gabriel_flat_avatar.png" alt="Somsri Avatar" className="w-full h-full object-cover" />
             </div>
             {/* Progress/Activity Animation */}
             {isAgentSpeaking && (
                 <div className="absolute -bottom-2 -right-2 bg-amber-500 text-white w-12 h-12 flex items-center justify-center rounded-full shadow-lg animate-bounce text-2xl border-2 border-white">
                     {THAI_ICONS[iconIndex]}
                 </div>
             )}
        </div>
        
        {/* User Volume Visualizer */}
        {status === 'connected' && !isAgentSpeaking && (
             <div className="h-10 flex items-center justify-center gap-1 mb-6">
                 {[...Array(5)].map((_, i) => (
                     <div 
                        key={i} 
                        className="w-2 bg-emerald-400 rounded-full transition-all duration-75"
                        style={{ height: `${Math.max(8, volume * 50 * (Math.random() + 0.5))}px` }}
                     ></div>
                 ))}
                 <span className="text-sm text-indigo-200 ml-2">Listening...</span>
             </div>
        )}

        <h2 className="text-xl font-bold mb-2 h-8 text-center">
            {status === 'idle' && "Ready to chat?"}
            {status === 'connecting' && <span className="animate-pulse">Connecting to Somsri...</span>}
            {status === 'connected' && isAgentSpeaking && "Somsri is thinking..."}
            {status === 'connected' && !isAgentSpeaking && " "}
            {status === 'error' && "Connection Error"}
        </h2>
        
        <p className="text-indigo-200 text-center mb-8 px-4 text-sm min-h-[40px]">
            {status === 'idle' 
                ? "Talk to our AI guide to discover the best spots, then create your plan instantly." 
                : "Discuss your dream trip. When you're ready, click 'Create Plan' to see your itinerary."}
        </p>

        {status === 'idle' || status === 'disconnected' ? (
             <button 
                onClick={startSession}
                className="w-full px-6 py-4 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-bold transition-all shadow-lg shadow-indigo-500/30 text-lg flex items-center justify-center gap-3"
            >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                Start Conversation
            </button>
        ) : (
            <div className="flex gap-3 w-full">
                <button 
                    onClick={onClose}
                    className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl font-semibold transition-colors text-sm"
                >
                    End Call
                </button>
                <button 
                    onClick={handleCreatePlan}
                    className="flex-1 px-4 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold transition-all shadow-lg shadow-amber-500/30 text-sm flex items-center justify-center gap-2 group"
                >
                    <span className="group-hover:animate-pulse">✨</span>
                    Create Plan
                </button>
            </div>
        )}
      </div>
    </div>
  );
};

export default LiveSession;
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Modality, LiveServerMessage } from '@google/genai';
import { getLiveClient } from '../services/geminiService';
import { float32ToPCM16, decodeBase64, decodeAudioData, encodeBase64 } from '../services/audioUtils';

interface LiveSessionProps {
  onClose: () => void;
}

const LiveSession: React.FC<LiveSessionProps> = ({ onClose }) => {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error' | 'disconnected'>('connecting');
  const [volume, setVolume] = useState(0);
  
  // Audio Refs
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const mountedRef = useRef(true);

  // Animation frame for volume visualizer
  const requestRef = useRef<number>(0);

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

  useEffect(() => {
    const initSession = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;

        // Input Audio Setup (16kHz for input)
        inputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        const source = inputContextRef.current.createMediaStreamSource(stream);
        // Use ScriptProcessor for raw PCM access (Worklet is better but more complex to setup in single file)
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
                setVolume(Math.min(rms * 5, 1)); // Amplify for visual

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
                 source.addEventListener('ended', () => {
                   sourcesRef.current.delete(source);
                 });
                 
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
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
            },
            systemInstruction: "You are a friendly, energetic Thai local guide. Speak briefly and enthusiastically about Thailand.",
          }
        });

      } catch (err) {
        console.error("Failed to initialize live session", err);
        setStatus('error');
      }
    };

    initSession();

    return cleanup;
  }, [cleanup]);

  return (
    <div className="flex flex-col items-center justify-center p-8 bg-gradient-to-br from-indigo-900 to-purple-900 rounded-2xl text-white shadow-2xl w-full max-w-md mx-auto relative overflow-hidden">
        {/* Background Decorative Elements */}
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
            <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
                <path fill="#FF0066" d="M44.7,-76.4C58.9,-69.2,71.8,-59.1,81.6,-46.6C91.4,-34.1,98.1,-19.2,95.8,-5.3C93.5,8.6,82.2,21.4,70.6,31.4C59,41.4,47.1,48.6,35.2,55.3C23.3,62,11.4,68.2,-1.3,70.5C-14,72.8,-28.3,71.2,-41.2,65.2C-54.1,59.2,-65.6,48.8,-73.8,36.1C-82,23.4,-86.9,8.4,-85.1,-5.8C-83.3,-20,-74.8,-33.4,-64,-44.6C-53.2,-55.8,-40.1,-64.8,-26.6,-72.5C-13.1,-80.2,0.8,-86.6,14.7,-85.4L28.6,-84.2Z" transform="translate(100 100)" />
            </svg>
        </div>

      <div className="relative z-10 flex flex-col items-center">
        <div className={`w-32 h-32 rounded-full flex items-center justify-center mb-6 transition-all duration-300 ${status === 'connected' ? 'bg-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.6)]' : 'bg-gray-700'}`}>
           <div 
             className="w-24 h-24 rounded-full bg-white opacity-90 transition-transform duration-75"
             style={{ transform: `scale(${1 + volume})` }}
           ></div>
        </div>
        
        <h2 className="text-2xl font-bold mb-2">
            {status === 'connecting' && "Connecting..."}
            {status === 'connected' && "Listening..."}
            {status === 'error' && "Connection Error"}
            {status === 'disconnected' && "Session Ended"}
        </h2>
        <p className="text-indigo-200 text-center mb-8 px-4">
            Ask about food, history, or where to go next!
        </p>

        <button 
            onClick={onClose}
            className="px-6 py-2 bg-red-500 hover:bg-red-600 rounded-full font-semibold transition-colors shadow-lg"
        >
            End Call
        </button>
      </div>
    </div>
  );
};

export default LiveSession;
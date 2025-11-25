
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Modality, LiveServerMessage } from '@google/genai';
import { getLiveClient } from '../services/geminiService';
import { float32ToPCM16, decodeBase64, decodeAudioData, encodeBase64 } from '../services/audioUtils';

interface LiveSessionProps {
  onClose: () => void;
  onCreatePlan: (transcript: string) => void;
}

// Metaphor assets
const INGREDIENTS = ['🦐', '🍋', '🥜', '🌶️', '🍜'];

const LiveSession: React.FC<LiveSessionProps> = ({ onClose, onCreatePlan }) => {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error' | 'disconnected'>('idle');
  const [volume, setVolume] = useState(0);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  
  // 0 = Prep (Intro), 1 = Refine (Chat), 2 = Cook (Processing), 3 = Serve (Done)
  const [cookingStage, setCookingStage] = useState<0 | 1 | 2 | 3>(0);
  
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

  const requestRef = useRef<number>(0);

  const cleanup = useCallback(() => {
    mountedRef.current = false;
    if (sourcesRef.current) {
        sourcesRef.current.forEach(source => {
            try { source.stop(); } catch(e) {}
        });
        sourcesRef.current.clear();
    }
    inputContextRef.current?.close();
    outputContextRef.current?.close();
    streamRef.current?.getTracks().forEach(track => track.stop());
    if (sessionPromiseRef.current) {
        sessionPromiseRef.current.then(session => session.close()).catch(() => {});
    }
    if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
    }
  }, []);

  useEffect(() => {
      return cleanup;
  }, [cleanup]);

  const startSession = async () => {
    setStatus('connecting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      inputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const source = inputContextRef.current.createMediaStreamSource(stream);
      const processor = inputContextRef.current.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      
      source.connect(processor);
      processor.connect(inputContextRef.current.destination);

      outputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const outputNode = outputContextRef.current.createGain();
      outputNode.connect(outputContextRef.current.destination);

      const liveClient = getLiveClient();

      sessionPromiseRef.current = liveClient.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            if (mountedRef.current) {
                setStatus('connected');
                setCookingStage(1); // Move to "Refine" stage
            }
            
            processor.onaudioprocess = (e) => {
              if (!mountedRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              
              let sum = 0;
              for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              setVolume(Math.min(rms * 5, 1)); 

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
                 if (sourcesRef.current) {
                     sourcesRef.current.delete(source);
                     if (sourcesRef.current.size === 0) {
                       setIsAgentSpeaking(false);
                     }
                 }
               };
               
               setIsAgentSpeaking(true);
               source.start(nextStartTimeRef.current);
               nextStartTimeRef.current += audioBuffer.duration;
               if (sourcesRef.current) sourcesRef.current.add(source);
             }

             if (message.serverContent?.interrupted) {
               if (sourcesRef.current) {
                   sourcesRef.current.forEach(src => {
                     try { src.stop(); } catch(e) {}
                   });
                   sourcesRef.current.clear();
               }
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
          systemInstruction: `
            You are Somsri, an expert Thai tour guide.
            
            Your Goal: Plan a perfect day trip for the user in Thailand.
            
            Step 1: Ask the user what city they are in or want to visit.
            Step 2: Ask about their specific interests (food, temples, shopping, nature).
            Step 3: Offer 1-2 quick suggestions to gauge their reaction.
            
            Keep your responses concise, warm, and encouraging. Do not output a full itinerary list yet, just discuss options.
          `,
        }
      });

    } catch (err) {
      console.error("Failed to initialize live session", err);
      setStatus('error');
    }
  };

  const handleCreatePlan = () => {
     // Move to Stage 2: Cook
     setCookingStage(2);
     
     // Stop audio session
     if (sessionPromiseRef.current) {
        sessionPromiseRef.current.then(session => session.close()).catch(() => {});
     }

     // Capture final text bits
     let finalTranscript = transcriptionRef.current;
     if (currentInputTransRef.current) finalTranscript += `User: ${currentInputTransRef.current}\n`;
     if (currentOutputTransRef.current) finalTranscript += `Guide: ${currentOutputTransRef.current}\n`;

     // Simulate "Cooking" time then move to "Served"
     setTimeout(() => {
         if (mountedRef.current) setCookingStage(3); // Move to "Served"
         
         // Short delay to admire the served dish before routing
         setTimeout(() => {
             onCreatePlan(finalTranscript);
         }, 1500);
     }, 2500);
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 bg-gradient-to-br from-indigo-900 to-purple-900 rounded-2xl text-white shadow-2xl w-full max-w-md mx-auto relative overflow-hidden min-h-[600px]">
        
        {/* Background Patterns */}
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
            <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
                <path fill="#FFB100" d="M42.7,-73.2C55.9,-67.1,67.9,-57.9,76.6,-46.5C85.3,-35.1,90.7,-21.5,89.8,-8.3C88.8,4.9,81.5,17.7,72.8,29.3C64.1,40.9,54,51.3,42.5,59.3C31,67.3,18.1,72.9,4.5,73.7C-9.1,74.5,-23.4,70.5,-36.6,63.4C-49.8,56.3,-61.9,46.1,-70.3,33.6C-78.7,21.1,-83.4,6.3,-81.7,-7.7C-80,-21.7,-71.9,-34.9,-61.2,-45.6C-50.5,-56.3,-37.2,-64.5,-23.9,-70.3C-10.6,-76.1,2.7,-79.5,15.5,-79.3C28.3,-79.1,40.5,-75.3,42.7,-73.2Z" transform="translate(100 100)" />
            </svg>
        </div>

      {/* 4-Step Progress Stepper */}
      <div className="w-full flex justify-between items-center px-2 mb-8 relative z-20">
          {[0, 1, 2, 3].map((step) => {
              const labels = ['Prep', 'Refine', 'Cook', 'Serve'];
              const isActive = cookingStage >= step;
              const isCurrent = cookingStage === step;
              
              return (
                  <div key={step} className="flex flex-col items-center gap-2 relative z-10">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all duration-500 ${
                          isActive ? 'bg-amber-500 text-white scale-110 shadow-lg shadow-amber-500/50' : 'bg-indigo-950/50 text-indigo-400 border-2 border-indigo-800'
                      }`}>
                          {step === 0 ? '1' : step === 1 ? '2' : step === 2 ? '3' : '4'}
                      </div>
                      <span className={`text-[10px] font-bold uppercase tracking-wider transition-colors duration-300 ${isCurrent ? 'text-amber-400' : 'text-indigo-400/60'}`}>
                          {labels[step]}
                      </span>
                  </div>
              );
          })}
          {/* Connector Lines Background */}
          <div className="absolute top-4 left-8 right-8 h-0.5 bg-indigo-950 -z-10" />
          {/* Connector Lines Active */}
          <div className="absolute top-4 left-8 right-8 h-0.5 -z-10 overflow-hidden">
              <div className="h-full bg-amber-500 transition-all duration-700 ease-out" style={{ width: `${(cookingStage / 3) * 100}%` }}></div>
          </div>
      </div>

      <div className="relative z-10 flex flex-col items-center w-full flex-1 justify-center">
        
        {/* STAGE 1: PREP (Intro) */}
        {cookingStage === 0 && (
            <div className="animate-fade-in text-center">
                <div className="relative w-40 h-40 mx-auto mb-6">
                    <div className="w-36 h-36 rounded-full overflow-hidden border-4 border-indigo-400 bg-white mx-auto relative z-10 shadow-xl">
                        <img src="/flat-gabriel.svg" alt="Somsri" className="w-full h-full object-cover" />
                    </div>
                    {/* Floating Ingredients */}
                    {INGREDIENTS.map((icon, i) => (
                        <div key={i} className="absolute text-2xl animate-float" 
                             style={{ 
                                 top: `${Math.sin(i * 1.5)*45 + 40}%`, 
                                 left: `${Math.cos(i * 1.5)*55 + 40}%`,
                                 animationDelay: `${i * 0.3}s` 
                             }}>
                            {icon}
                        </div>
                    ))}
                </div>
                <h3 className="text-2xl font-bold mb-2 text-white">Step 1: Prep</h3>
                <p className="text-indigo-200 text-sm px-6 mb-8 leading-relaxed">
                    Ready to cook up a plan? Tell Somsri where you are and what you love.
                </p>
                <button 
                    onClick={startSession}
                    className="px-8 py-4 bg-amber-500 hover:bg-amber-600 text-white rounded-full font-bold transition-all shadow-lg shadow-amber-500/30 flex items-center gap-3 mx-auto hover:scale-105 transform active:scale-95"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                    Start Conversation
                </button>
            </div>
        )}

        {/* STAGE 2: REFINE (Chat) */}
        {cookingStage === 1 && (
            <div className="animate-fade-in text-center w-full flex flex-col h-full">
                 <div className="flex-1 flex flex-col items-center justify-center">
                    <div className="relative w-40 h-40 mx-auto mb-4">
                        <div className={`w-36 h-36 rounded-full overflow-hidden border-4 transition-all duration-300 bg-white mx-auto relative z-10 ${isAgentSpeaking ? 'border-amber-400 shadow-[0_0_30px_rgba(251,191,36,0.6)] scale-105' : 'border-indigo-400'}`}>
                            <img src="/flat-gabriel.svg" alt="Somsri" className="w-full h-full object-cover" />
                        </div>
                    </div>

                    <div className="h-12 flex items-center justify-center gap-1 mb-2">
                        {isAgentSpeaking ? (
                             <div className="flex flex-col items-center gap-1">
                                <span className="text-2xl animate-bounce">🗣️</span>
                                <span className="text-amber-400 text-xs font-bold uppercase tracking-wide animate-pulse">Somsri Speaking</span>
                             </div>
                        ) : (
                            <div className="flex flex-col items-center w-full">
                                <div className="flex gap-1 h-8 items-end mb-1">
                                    {[...Array(5)].map((_, i) => (
                                        <div 
                                           key={i} 
                                           className="w-1.5 bg-emerald-400 rounded-full transition-all duration-75"
                                           style={{ height: `${Math.max(6, volume * 50 * (Math.random() + 0.5))}px` }}
                                        ></div>
                                    ))}
                                </div>
                                <span className="text-xs text-indigo-300">Listening...</span>
                            </div>
                        )}
                    </div>
                    
                    <p className="text-white font-medium text-lg mb-1">Step 2: Refine</p>
                    <p className="text-indigo-300 text-xs px-8 mb-6">
                        "Tell me more! The more spice (details) you add, the better the plan."
                    </p>
                </div>

                <div className="w-full px-4 pb-4">
                    <button 
                        onClick={handleCreatePlan}
                        className="w-full px-6 py-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white rounded-2xl font-bold transition-all shadow-xl shadow-emerald-500/20 flex items-center justify-center gap-3 group hover:scale-[1.02] active:scale-[0.98]"
                    >
                        <span className="text-2xl group-hover:rotate-12 transition-transform">👨‍🍳</span>
                        <div className="text-left">
                            <div className="text-xs text-emerald-100 font-medium uppercase tracking-wider">Ready?</div>
                            <div className="text-lg leading-none">Start Cooking Plan</div>
                        </div>
                        <svg className="w-5 h-5 ml-auto text-emerald-100" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                    </button>
                    <button 
                        onClick={onClose}
                        className="mt-3 text-indigo-400 text-xs hover:text-white underline decoration-indigo-500/50 underline-offset-4 transition-colors"
                    >
                        Cancel Session
                    </button>
                </div>
            </div>
        )}

        {/* STAGE 3: COOK (Processing) */}
        {cookingStage === 2 && (
             <div className="animate-fade-in text-center w-full">
                 <div className="relative w-48 h-48 mx-auto mb-8">
                     {/* Wok Animation */}
                     <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-40 h-12 bg-gray-800 rounded-b-full border-b-4 border-gray-600 z-10 flex items-center justify-center overflow-hidden">
                         {/* Food tossing inside */}
                         <div className="w-full h-full relative">
                            <span className="absolute left-1/4 bottom-2 text-xl animate-[bounce_0.8s_infinite]">🍤</span>
                            <span className="absolute left-1/2 bottom-4 text-xl animate-[bounce_0.9s_infinite_0.2s]">🥬</span>
                            <span className="absolute right-1/4 bottom-1 text-xl animate-[bounce_0.7s_infinite_0.4s]">🌶️</span>
                         </div>
                     </div>
                     
                     {/* Fire */}
                     <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2 flex gap-1 z-0">
                         <div className="text-3xl animate-[pulse_0.4s_infinite] origin-bottom transform scale-y-110">🔥</div>
                         <div className="text-4xl animate-[pulse_0.5s_infinite_0.1s] origin-bottom -mt-2">🔥</div>
                         <div className="text-3xl animate-[pulse_0.4s_infinite_0.2s] origin-bottom transform scale-y-110">🔥</div>
                     </div>

                     {/* Steam/Smoke */}
                     <div className="absolute top-0 left-1/2 transform -translate-x-1/2 flex gap-2 opacity-60">
                         <div className="w-2 h-12 bg-white rounded-full blur-sm animate-[float_2s_infinite]"></div>
                         <div className="w-2 h-16 bg-white rounded-full blur-sm animate-[float_2.5s_infinite_0.5s]"></div>
                         <div className="w-2 h-10 bg-white rounded-full blur-sm animate-[float_1.8s_infinite_1s]"></div>
                     </div>
                 </div>

                 <h3 className="text-3xl font-bold mb-2 text-white">Step 3: Cooking</h3>
                 <p className="text-indigo-200 text-sm animate-pulse">
                     Somsri is mixing your ingredients...
                 </p>
            </div>
        )}

        {/* STAGE 4: SERVE (Done) */}
        {cookingStage === 3 && (
            <div className="animate-fade-in-up text-center">
                 <div className="w-48 h-48 rounded-full bg-white border-8 border-double border-emerald-500 mx-auto mb-6 flex items-center justify-center shadow-[0_0_60px_rgba(16,185,129,0.6)] relative">
                     <span className="text-7xl transform hover:scale-110 transition-transform cursor-default">🍲</span>
                     {/* Sparkles */}
                     <span className="absolute top-2 right-4 text-2xl animate-ping">✨</span>
                     <span className="absolute bottom-4 left-4 text-2xl animate-ping delay-300">✨</span>
                 </div>
                 <h3 className="text-3xl font-bold mb-2 text-white">Step 4: Served!</h3>
                 <p className="text-emerald-300 font-medium mb-8">
                     Your custom itinerary is ready.
                 </p>
                 
                 <div className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-950/50 rounded-lg text-indigo-300 text-xs">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Opening Planner...
                 </div>
            </div>
        )}
        
      </div>
    </div>
  );
};

export default LiveSession;
    
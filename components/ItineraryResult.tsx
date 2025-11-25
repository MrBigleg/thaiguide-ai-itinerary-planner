import React, { useState, useRef, useEffect } from 'react';
import { GroundingChunk } from '../types';
import { generateSpeech } from '../services/geminiService';

interface ItineraryResultProps {
  content: string;
  groundingChunks?: GroundingChunk[];
}

const ItineraryResult: React.FC<ItineraryResultProps> = ({ content, groundingChunks }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(console.error);
      }
    };
  }, []);

  // Helper to process text and insert links
  const renderContent = () => {
    // Basic markdown-like rendering for bold text
    const paragraphs = content.split('\n');
    return paragraphs.map((p, idx) => {
        if (!p.trim()) return <br key={idx} />;
        
        // Simple bold parser
        const parts = p.split(/\*\*(.*?)\*\*/g);
        return (
            <p key={idx} className="mb-2 text-slate-700 leading-relaxed">
                {parts.map((part, i) => 
                    i % 2 === 1 ? <strong key={i} className="text-indigo-900">{part}</strong> : part
                )}
            </p>
        );
    });
  };

  const handleReadAloud = async () => {
    if (isPlaying) {
        // Stop playback logic if needed (not implemented in original, but good practice to allow toggle)
        // For now, just return to match behavior or simple block
        return; 
    }
    
    setIsLoadingAudio(true);
    try {
        const audioBuffer = await generateSpeech(content.substring(0, 1000)); // Limit length for demo
        
        // Close previous context if exists
        if (audioContextRef.current) {
            await audioContextRef.current.close();
        }

        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = ctx;

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.start();
        setIsPlaying(true);
        
        source.onended = () => {
            setIsPlaying(false);
            ctx.close().then(() => {
                if (audioContextRef.current === ctx) {
                    audioContextRef.current = null;
                }
            });
        };
    } catch (e) {
        console.error(e);
        alert("Could not generate speech.");
    } finally {
        setIsLoadingAudio(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 border border-slate-100">
      <div className="flex justify-between items-start mb-6 border-b border-slate-100 pb-4">
        <h2 className="text-2xl font-bold text-slate-800">Your Plan</h2>
        <button
          onClick={handleReadAloud}
          disabled={isLoadingAudio || isPlaying}
          className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800 disabled:opacity-50 transition-colors"
        >
            {isLoadingAudio ? (
                <span className="animate-pulse">Loading Audio...</span>
            ) : isPlaying ? (
                <span>Playing...</span>
            ) : (
                <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                    <span className="font-medium">Read Aloud</span>
                </>
            )}
        </button>
      </div>

      <div className="prose prose-slate max-w-none">
        {renderContent()}
      </div>

      {groundingChunks && groundingChunks.length > 0 && (
        <div className="mt-8 pt-6 border-t border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">Sources & Maps</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {groundingChunks.map((chunk, i) => {
               if (chunk.maps) {
                   return (
                       <a key={i} href={chunk.maps.uri} target="_blank" rel="noopener noreferrer" className="flex items-center p-3 bg-slate-50 hover:bg-indigo-50 rounded-lg border border-slate-200 transition-colors group">
                           <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center flex-shrink-0 mr-3">
                               <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>
                           </div>
                           <div className="overflow-hidden">
                               <p className="font-medium text-slate-800 truncate group-hover:text-indigo-700">{chunk.maps.title}</p>
                               <p className="text-xs text-slate-500">Google Maps</p>
                           </div>
                       </a>
                   )
               }
               if (chunk.web) {
                   return (
                       <a key={i} href={chunk.web.uri} target="_blank" rel="noopener noreferrer" className="flex items-center p-3 bg-slate-50 hover:bg-emerald-50 rounded-lg border border-slate-200 transition-colors group">
                            <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0 mr-3">
                               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
                            </div>
                           <div className="overflow-hidden">
                               <p className="font-medium text-slate-800 truncate group-hover:text-emerald-700">{chunk.web.title}</p>
                               <p className="text-xs text-slate-500">Web Source</p>
                           </div>
                       </a>
                   )
               }
               return null;
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ItineraryResult;
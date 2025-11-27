
import React, { useState, useRef, useEffect } from 'react';
import { GroundingChunk } from '../types';
import { generateSpeech } from '../services/geminiService';
import PlaceCard from './PlaceCard';

interface ItineraryResultProps {
  content: string;
  groundingChunks?: GroundingChunk[];
  onPlaceUpdate?: (location: google.maps.LatLng) => void;
}

const ItineraryResult: React.FC<ItineraryResultProps> = ({ content, groundingChunks, onPlaceUpdate }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Extract potential place names from grounding chunks for the widget
  const places = groundingChunks?.filter(c => c.maps?.title).map(c => c.maps!.title) || [];
  // Deduplicate places
  const uniquePlaces = Array.from(new Set(places));

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(console.error);
      }
    };
  }, []);

  const renderContent = () => {
    const paragraphs = content.split('\n');
    return paragraphs.map((p, idx) => {
        if (!p.trim()) return <br key={idx} />;
        const parts = p.split(/\*\*(.*?)\*\*/g);
        return (
            <p key={idx} className="mb-3 text-slate-700 leading-relaxed font-light">
                {parts.map((part, i) => 
                    i % 2 === 1 ? <strong key={i} className="text-indigo-900 font-semibold">{part}</strong> : part
                )}
            </p>
        );
    });
  };

  const handleReadAloud = async () => {
    if (isPlaying) return;
    
    setIsLoadingAudio(true);
    try {
        const audioBuffer = await generateSpeech(content.substring(0, 1000));
        
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
    <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-2xl border border-amber-100/50 p-8 relative overflow-hidden">
      {/* Decorative Thai Pattern Background Effect */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-amber-200/20 to-transparent rounded-bl-[100px] -z-10 pointer-events-none"></div>

      <div className="flex justify-between items-start mb-8 border-b border-amber-100 pb-6">
        <div>
            <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-900 to-purple-900 mb-2">
                Your Thai Adventure
            </h2>
            <p className="text-amber-600 text-sm font-medium uppercase tracking-wider">Curated by Somsri</p>
        </div>
        
        <button
          onClick={handleReadAloud}
          disabled={isLoadingAudio || isPlaying}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all
            ${isPlaying 
                ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-400 ring-offset-2' 
                : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}
          `}
        >
            {isLoadingAudio ? (
                <span className="animate-pulse">Generating...</span>
            ) : isPlaying ? (
                <>
                    <span className="animate-bounce">🔊</span> 
                    <span>Listen</span>
                </>
            ) : (
                <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                    <span>Read Aloud</span>
                </>
            )}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Text Content */}
          <div className="lg:col-span-2 prose prose-slate prose-p:font-light max-w-none">
            {renderContent()}
          </div>

          {/* Suggested Places Cards */}
          <div className="lg:col-span-1 space-y-6">
             <h3 className="text-lg font-bold text-indigo-900 border-l-4 border-amber-400 pl-3">
                 Recommended Stops
             </h3>
             <div className="space-y-4">
                {uniquePlaces.map((placeName, idx) => (
                    <PlaceCard key={idx} query={placeName} onPlaceSelect={onPlaceUpdate} />
                ))}
                {uniquePlaces.length === 0 && (
                    <p className="text-sm text-slate-400 italic">
                        Places will appear here when mentioned in your itinerary.
                    </p>
                )}
             </div>
          </div>
      </div>

      {groundingChunks && groundingChunks.length > 0 && (
        <div className="mt-8 pt-6 border-t border-slate-100">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Sources</h3>
          <div className="flex flex-wrap gap-2">
            {groundingChunks.map((chunk, i) => {
               if (chunk.web) {
                   return (
                       <a key={i} href={chunk.web.uri} target="_blank" rel="noopener noreferrer" className="inline-flex items-center px-3 py-1 bg-slate-50 hover:bg-indigo-50 text-indigo-600 text-xs rounded-lg border border-slate-200 transition-colors truncate max-w-[200px]">
                           <span className="mr-1">🔗</span>
                           {chunk.web.title}
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
